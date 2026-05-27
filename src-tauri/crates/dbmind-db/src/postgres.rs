use async_trait::async_trait;
use dbmind_core::errors::DbError;
use dbmind_core::types::*;
use std::time::Instant;
use tokio::sync::Mutex;

use crate::connection::{Driver, QueryResult};

pub struct PostgresDriver {
    client: Mutex<Option<tokio_postgres::Client>>,
    _handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    schema_name: std::sync::OnceLock<String>,
}

impl PostgresDriver {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
            _handle: Mutex::new(None),
            schema_name: std::sync::OnceLock::new(),
        }
    }
}

fn build_column_meta(col: &tokio_postgres::Column) -> ColumnMeta {
    ColumnMeta {
        name: col.name().to_string(),
        data_type: format!("{:?}", col.type_()),
        nullable: true,
        is_primary_key: false,
        default_value: None,
        comment: None,
        max_length: None,
        decimal_digits: None,
    }
}

#[async_trait]
impl Driver for PostgresDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<(), DbError> {
        let conn_str = format!(
            "host={} port={} user={} password={} dbname={}",
            config.host,
            config.port,
            config.username,
            config.password.as_deref().unwrap_or(""),
            config.database.as_deref().unwrap_or("postgres")
        );

        let (client, connection) = tokio_postgres::connect(&conn_str, tokio_postgres::NoTls)
            .await
            .map_err(|e| DbError::ConnectionFailed(e.to_string()))?;

        let handle = tokio::spawn(async move {
            if let Err(e) = connection.await {
                log::error!("PostgreSQL connection error: {}", e);
            }
        });

        let mut stored_client = self.client.lock().await;
        *stored_client = Some(client);
        let mut stored_handle = self._handle.lock().await;
        *stored_handle = Some(handle);

        let db_name = config.database.clone().unwrap_or_else(|| "public".to_string());
        let _ = self.schema_name.set(db_name);

        Ok(())
    }

    async fn disconnect(&self) -> Result<(), DbError> {
        let mut client_guard = self.client.lock().await;
        *client_guard = None;
        let mut handle_guard = self._handle.lock().await;
        if let Some(h) = handle_guard.take() {
            h.abort();
        }
        Ok(())
    }

    async fn exec(&self, sql: &str) -> Result<QueryResult, DbError> {
        let start = Instant::now();
        let client_lock = self.client.lock().await;
        let client = client_lock.as_ref().ok_or(DbError::NotConnected)?;

        let trimmed = sql.trim().to_uppercase();
        let is_query = trimmed.starts_with("SELECT")
            || trimmed.starts_with("WITH")
            || trimmed.starts_with("SHOW")
            || trimmed.starts_with("EXPLAIN");

        if is_query {
            let statement = client
                .prepare(sql)
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;

            let columns: Vec<ColumnMeta> =
                statement.columns().iter().map(build_column_meta).collect();

            let rows = client
                .query(&statement, &[])
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;

            let data: Vec<Vec<CellValue>> = rows
                .iter()
                .map(|row| {
                    (0..row.len())
                        .map(|i| {
                            let col_type = row.columns()[i].type_();
                            cell_from_pg(row, i, col_type)
                        })
                        .collect()
                })
                .collect();

            drop(client_lock);
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(QueryResult {
                columns,
                rows: data,
                affected_rows: None,
                execution_time_ms: elapsed,
            })
        } else {
            let affected = client
                .execute(sql, &[])
                .await
                .map_err(|e| DbError::QueryFailed(e.to_string()))?;

            drop(client_lock);
            let elapsed = start.elapsed().as_millis() as u64;
            Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                affected_rows: Some(affected),
                execution_time_ms: elapsed,
            })
        }
    }

    async fn is_connected(&self) -> bool {
        self.client.lock().await.is_some()
    }

    fn driver_type(&self) -> DatabaseDriver {
        DatabaseDriver::Postgres
    }

    fn schema(&self) -> &str {
        self.schema_name.get().map(|s| s.as_str()).unwrap_or("public")
    }
}

fn cell_from_pg(
    row: &tokio_postgres::Row,
    idx: usize,
    col_type: &tokio_postgres::types::Type,
) -> CellValue {
    use tokio_postgres::types::Type;
    macro_rules! try_get {
        ($t:ty) => {
            row.try_get::<_, Option<$t>>(idx).ok().flatten()
        };
    }

    match *col_type {
        Type::BOOL => match try_get!(bool) {
            Some(v) => CellValue::Bool(v),
            None => CellValue::Null,
        },
        Type::INT2 => match try_get!(i16) {
            Some(v) => CellValue::Int(v as i64),
            None => CellValue::Null,
        },
        Type::INT4 => match try_get!(i32) {
            Some(v) => CellValue::Int(v as i64),
            None => CellValue::Null,
        },
        Type::INT8 => match try_get!(i64) {
            Some(v) => CellValue::Int(v),
            None => CellValue::Null,
        },
        Type::FLOAT4 => match try_get!(f32) {
            Some(v) => CellValue::Float(v as f64),
            None => CellValue::Null,
        },
        Type::FLOAT8 => match try_get!(f64) {
            Some(v) => CellValue::Float(v),
            None => CellValue::Null,
        },
        Type::NUMERIC => {
            // NUMERIC comes as text from tokio-postgres by default
            match row.try_get::<_, Option<String>>(idx) {
                Ok(Some(s)) => s
                    .parse::<f64>()
                    .map(CellValue::Float)
                    .unwrap_or(CellValue::String(s)),
                _ => CellValue::Null,
            }
        }
        Type::BPCHAR
        | Type::VARCHAR
        | Type::TEXT
        | Type::NAME
        | Type::DATE
        | Type::TIME
        | Type::TIMESTAMP
        | Type::TIMESTAMPTZ
        | Type::UUID
        | Type::JSON
        | Type::JSONB => match row.try_get::<_, Option<String>>(idx) {
            Ok(Some(s)) => CellValue::String(s),
            _ => CellValue::Null,
        },
        Type::BYTEA => match row.try_get::<_, Option<Vec<u8>>>(idx) {
            Ok(Some(b)) => CellValue::Blob(b),
            _ => CellValue::Null,
        },
        _ => {
            // Fallback: try to get as string
            match row.try_get::<_, Option<String>>(idx) {
                Ok(Some(s)) => CellValue::String(s),
                _ => CellValue::Null,
            }
        }
    }
}
