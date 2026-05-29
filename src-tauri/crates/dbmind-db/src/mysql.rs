use async_trait::async_trait;
use dbmind_core::errors::DbError;
use dbmind_core::types::*;
use mysql_async::prelude::*;
use mysql_async::{OptsBuilder, Value};
use std::collections::HashMap;
use std::time::Instant;
use tokio::sync::Mutex;

use crate::connection::{Driver, QueryResult};

pub struct MysqlDriver {
    pool: Mutex<Option<mysql_async::Pool>>,
    schema_name: std::sync::OnceLock<String>,
    active_query_threads: Mutex<HashMap<String, u32>>,
}

impl MysqlDriver {
    pub fn new() -> Self {
        Self {
            pool: Mutex::new(None),
            schema_name: std::sync::OnceLock::new(),
            active_query_threads: Mutex::new(HashMap::new()),
        }
    }

    async fn pool(&self) -> Result<mysql_async::Pool, DbError> {
        self.pool
            .lock()
            .await
            .as_ref()
            .cloned()
            .ok_or(DbError::NotConnected)
    }
}

fn mysql_value_to_cell(v: &Value) -> CellValue {
    match v {
        Value::NULL => CellValue::Null,
        Value::Int(n) => CellValue::Int(*n),
        Value::UInt(n) => CellValue::Int(*n as i64),
        Value::Float(f) => CellValue::Float(*f as f64),
        Value::Double(d) => CellValue::Float(*d),
        Value::Bytes(b) => match String::from_utf8(b.clone()) {
            Ok(s) => CellValue::String(s),
            Err(_) => CellValue::Blob(b.clone()),
        },
        _ => CellValue::String(format!("{:?}", v)),
    }
}

fn build_column_meta(col: &mysql_async::Column) -> ColumnMeta {
    let flags = col.flags();
    ColumnMeta {
        name: col.name_str().to_string(),
        data_type: format!("{:?}", col.column_type()),
        nullable: !flags.contains(mysql_async::consts::ColumnFlags::NOT_NULL_FLAG),
        is_primary_key: flags.contains(mysql_async::consts::ColumnFlags::PRI_KEY_FLAG),
        default_value: None,
        comment: None,
        max_length: Some(col.column_length() as u64),
        decimal_digits: Some(col.decimals() as u32),
    }
}

/// Strip leading line comments (--) and block comments (/* */) from SQL.
fn strip_leading_comments(sql: &str) -> &str {
    let mut s = sql.trim_start();
    loop {
        if s.starts_with("--") {
            if let Some(pos) = s.find('\n') {
                s = &s[pos + 1..];
                s = s.trim_start();
            } else {
                return "";
            }
        } else if s.starts_with("/*") {
            if let Some(pos) = s.find("*/") {
                s = &s[pos + 2..];
                s = s.trim_start();
            } else {
                return "";
            }
        } else {
            return s;
        }
    }
}

#[async_trait]
impl Driver for MysqlDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<(), DbError> {
        let builder = OptsBuilder::default()
            .ip_or_hostname(config.host.clone())
            .tcp_port(config.port)
            .user(Some(config.username.clone()))
            .pass(config.password.clone())
            .db_name(config.database.clone());

        let pool = mysql_async::Pool::new(builder);

        let mut conn = pool
            .get_conn()
            .await
            .map_err(|e| DbError::ConnectionFailed(e.to_string()))?;

        conn.query_iter("SELECT 1")
            .await
            .map_err(|e| DbError::ConnectionFailed(format!("Connection test failed: {}", e)))?;

        let mut stored = self.pool.lock().await;
        *stored = Some(pool);

        let _ = self.schema_name.set(config.database.clone().unwrap_or_default());

        Ok(())
    }

    async fn disconnect(&self) -> Result<(), DbError> {
        let mut pool_guard = self.pool.lock().await;
        if let Some(p) = pool_guard.take() {
            drop(pool_guard);
            p.disconnect()
                .await
                .map_err(|e| DbError::DriverError(e.to_string()))?;
        }
        Ok(())
    }

    async fn exec(&self, sql: &str) -> Result<QueryResult, DbError> {
        self.exec_with_query_id("", sql).await
    }

    async fn exec_with_query_id(&self, query_id: &str, sql: &str) -> Result<QueryResult, DbError> {
        let start = Instant::now();
        let pool = self.pool().await?;

        let mut conn = pool
            .get_conn()
            .await
            .map_err(|e| DbError::QueryFailed(e.to_string()))?;

        if !query_id.is_empty() {
            self.active_query_threads
                .lock()
                .await
                .insert(query_id.to_string(), conn.id());
        }

        let trimmed = strip_leading_comments(sql).trim().to_uppercase();
        let is_query = trimmed.starts_with("SELECT")
            || trimmed.starts_with("WITH")
            || trimmed.starts_with("SHOW")
            || trimmed.starts_with("DESCRIBE")
            || trimmed.starts_with("EXPLAIN");

        let result: Result<QueryResult, DbError> = async {
            if is_query {
                let mut result_set = conn
                    .query_iter(sql)
                    .await
                    .map_err(|e| DbError::QueryFailed(e.to_string()))?;

                let columns: Vec<ColumnMeta> = result_set
                    .columns()
                    .as_ref()
                    .map(|cols| cols.iter().map(build_column_meta).collect())
                    .unwrap_or_default();

                let mut rows: Vec<Vec<CellValue>> = Vec::new();
                while let Some(row) = result_set
                    .next()
                    .await
                    .map_err(|e| DbError::QueryFailed(e.to_string()))?
                {
                    let values: Vec<CellValue> = (0..row.len())
                        .map(|i| mysql_value_to_cell(&row[i]))
                        .collect();
                    rows.push(values);
                }

                drop(result_set);
                drop(conn);

                let elapsed = start.elapsed().as_millis() as u64;
                Ok(QueryResult {
                    columns,
                    rows,
                    affected_rows: None,
                    execution_time_ms: elapsed,
                })
            } else {
                conn.exec_drop(sql, ())
                    .await
                    .map_err(|e| DbError::QueryFailed(e.to_string()))?;

                let affected = conn.affected_rows();
                drop(conn);

                let elapsed = start.elapsed().as_millis() as u64;
                Ok(QueryResult {
                    columns: vec![],
                    rows: vec![],
                    affected_rows: Some(affected),
                    execution_time_ms: elapsed,
                })
            }
        }
        .await;

        if !query_id.is_empty() {
            self.active_query_threads.lock().await.remove(query_id);
        }

        result
    }

    async fn cancel_query(&self, query_id: &str) -> Result<(), DbError> {
        let Some(thread_id) = self
            .active_query_threads
            .lock()
            .await
            .get(query_id)
            .copied()
        else {
            log::warn!("No active MySQL thread found for query {}", query_id);
            return Ok(());
        };
        log::info!("Killing MySQL thread {} for query {}", thread_id, query_id);

        let pool = self.pool().await?;
        let mut conn = pool
            .get_conn()
            .await
            .map_err(|e| DbError::DriverError(e.to_string()))?;
        conn.query_drop(format!("KILL {}", thread_id))
            .await
            .map_err(|e| DbError::DriverError(e.to_string()))?;
        Ok(())
    }

    async fn is_connected(&self) -> bool {
        self.pool.lock().await.is_some()
    }

    fn driver_type(&self) -> DatabaseDriver {
        DatabaseDriver::Mysql
    }

    fn schema(&self) -> &str {
        self.schema_name.get().map(|s| s.as_str()).unwrap_or("")
    }
}
