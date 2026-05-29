use async_trait::async_trait;
use dbmind_core::errors::DbError;
use dbmind_core::types::*;
use std::collections::HashMap;
use std::time::Instant;
use tokio::sync::Mutex;

use crate::connection::{Driver, QueryResult};

pub struct PostgresDriver {
    client: Mutex<Option<tokio_postgres::Client>>,
    schema_name: std::sync::OnceLock<String>,
    cancel_tokens: Mutex<HashMap<String, tokio_postgres::CancelToken>>,
    ssl_enabled: std::sync::Mutex<bool>,
}

impl PostgresDriver {
    pub fn new() -> Self {
        Self {
            client: Mutex::new(None),
            schema_name: std::sync::OnceLock::new(),
            cancel_tokens: Mutex::new(HashMap::new()),
            ssl_enabled: std::sync::Mutex::new(false),
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
impl Driver for PostgresDriver {
    async fn connect(&self, config: &ConnectionConfig) -> Result<(), DbError> {
        use tokio_postgres::config::Config as PgConfig;

        log::info!("Connecting to PostgreSQL: host={}, port={}, user={}, db={}, ssl={}",
            config.host, config.port, config.username,
            config.database.as_deref().unwrap_or("postgres"), config.ssl);

        let mut pg_config = PgConfig::new();
        pg_config.host(&config.host);
        pg_config.port(config.port);
        pg_config.user(&config.username);
        if let Some(ref pw) = config.password {
            pg_config.password(pw.as_bytes());
        }
        pg_config.dbname(config.database.as_deref().unwrap_or("postgres"));

        let client = if config.ssl {
            pg_config.ssl_mode(tokio_postgres::config::SslMode::Require);

            let tls = postgres_openssl::MakeTlsConnector::new(
                openssl::ssl::SslConnector::builder(openssl::ssl::SslMethod::tls())
                    .map_err(|e| DbError::ConnectionFailed(format!("TLS init failed: {}", e)))?
                    .build()
            );

            let (client, connection) = pg_config
                .connect(tls)
                .await
                .map_err(|e| {
                    log::error!("PostgreSQL connection error: {}", e);
                    DbError::ConnectionFailed(format!("{} (host={}, port={})", e, config.host, config.port))
                })?;

            tokio::spawn(async move {
                if let Err(e) = connection.await {
                    log::error!("PostgreSQL connection error: {}", e);
                }
            });
            client
        } else {
            pg_config.ssl_mode(tokio_postgres::config::SslMode::Disable);

            let (client, connection) = pg_config
                .connect(tokio_postgres::NoTls)
                .await
                .map_err(|e| {
                    log::error!("PostgreSQL connection error: {}", e);
                    DbError::ConnectionFailed(format!("{} (host={}, port={})", e, config.host, config.port))
                })?;

            tokio::spawn(async move {
                if let Err(e) = connection.await {
                    log::error!("PostgreSQL connection error: {}", e);
                }
            });
            client
        };

        // Test the connection
        client
            .execute("SELECT 1", &[])
            .await
            .map_err(|e| DbError::ConnectionFailed(format!("Connection test failed: {}", e)))?;

        // If there's an existing connection, clean it up first
        {
        }

        let mut stored_client = self.client.lock().await;
        *stored_client = Some(client);
        // Note: connection task handle was already spawned above;
        // we intentionally don't store it since tokio_postgres Client
        // manages the connection lifecycle internally.

        let db_name = config.database.clone().unwrap_or_else(|| "public".to_string());
        let _ = self.schema_name.set(db_name);
        *self.ssl_enabled.lock().unwrap() = config.ssl;

        Ok(())
    }

    async fn disconnect(&self) -> Result<(), DbError> {
        let mut client_guard = self.client.lock().await;
        if let Some(client) = client_guard.take() {
            let token = client.cancel_token();
            let ssl = *self.ssl_enabled.lock().unwrap();
            if ssl {
                let tls = postgres_openssl::MakeTlsConnector::new(
                    openssl::ssl::SslConnector::builder(openssl::ssl::SslMethod::tls())
                        .map_err(|e| DbError::DriverError(format!("TLS init failed: {}", e)))?
                        .build()
                );
                let _ = token.cancel_query(tls).await;
            } else {
                let _ = token.cancel_query(tokio_postgres::NoTls).await;
            }
            drop(client);
        }
        Ok(())
    }

    async fn exec(&self, sql: &str) -> Result<QueryResult, DbError> {
        self.exec_with_query_id("", sql).await
    }

    async fn exec_with_query_id(&self, query_id: &str, sql: &str) -> Result<QueryResult, DbError> {
        let start = Instant::now();

        let (columns, data, affected) = {
            let client_lock = self.client.lock().await;
            let client = client_lock.as_ref().ok_or(DbError::NotConnected)?;

            // Store cancel token for this query
            if !query_id.is_empty() {
                let token = client.cancel_token();
                self.cancel_tokens.lock().await.insert(query_id.to_string(), token);
            }

            let trimmed = strip_leading_comments(sql).trim().to_uppercase();
            let is_query = trimmed.starts_with("SELECT")
                || trimmed.starts_with("WITH")
                || trimmed.starts_with("SHOW")
                || trimmed.starts_with("EXPLAIN")
                || trimmed.starts_with("TABLE")
                || trimmed.starts_with("VALUES");

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

                (Some(columns), Some(data), None)
            } else {
                let affected = client
                    .execute(sql, &[])
                    .await
                    .map_err(|e| DbError::QueryFailed(e.to_string()))?;
                (None, None, Some(affected))
            }
        }; // client_lock dropped here

        let elapsed = start.elapsed().as_millis() as u64;

        if !query_id.is_empty() {
            self.cancel_tokens.lock().await.remove(query_id);
        }

        match (columns, data, affected) {
            (Some(cols), Some(rows), None) => Ok(QueryResult {
                columns: cols,
                rows,
                affected_rows: None,
                execution_time_ms: elapsed,
            }),
            (None, None, Some(n)) => Ok(QueryResult {
                columns: vec![],
                rows: vec![],
                affected_rows: Some(n),
                execution_time_ms: elapsed,
            }),
            _ => Err(DbError::QueryFailed("Unexpected result state".to_string())),
        }
    }

    async fn cancel_query(&self, query_id: &str) -> Result<(), DbError> {
        let token = self.cancel_tokens.lock().await.remove(query_id);
        if let Some(ct) = token {
            log::info!("Cancelling PostgreSQL query {}", query_id);
            let ssl = *self.ssl_enabled.lock().unwrap();
            if ssl {
                let tls = postgres_openssl::MakeTlsConnector::new(
                    openssl::ssl::SslConnector::builder(openssl::ssl::SslMethod::tls())
                        .map_err(|e| DbError::DriverError(format!("TLS init failed: {}", e)))?
                        .build()
                );
                ct.cancel_query(tls)
                    .await
                    .map_err(|e| DbError::DriverError(e.to_string()))?;
            } else {
                ct.cancel_query(tokio_postgres::NoTls)
                    .await
                    .map_err(|e| DbError::DriverError(e.to_string()))?;
            }
        } else {
            log::warn!("No cancel token found for PostgreSQL query {}", query_id);
        }
        Ok(())
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
        | Type::JSONB
        | Type::INET
        | Type::CIDR
        | Type::MACADDR
        | Type::POINT
        | Type::INTERVAL => match row.try_get::<_, Option<String>>(idx) {
            Ok(Some(s)) => CellValue::String(s),
            _ => CellValue::Null,
        },
        Type::BYTEA => match row.try_get::<_, Option<Vec<u8>>>(idx) {
            Ok(Some(b)) => CellValue::Blob(b),
            _ => CellValue::Null,
        },
        Type::BOOL_ARRAY
        | Type::INT2_ARRAY
        | Type::INT4_ARRAY
        | Type::INT8_ARRAY
        | Type::FLOAT4_ARRAY
        | Type::FLOAT8_ARRAY
        | Type::TEXT_ARRAY
        | Type::VARCHAR_ARRAY => match row.try_get::<_, Option<String>>(idx) {
            Ok(Some(s)) => CellValue::String(s),
            _ => CellValue::Null,
        },
        _ => {
            match row.try_get::<_, Option<String>>(idx) {
                Ok(Some(s)) => CellValue::String(s),
                _ => CellValue::Null,
            }
        }
    }
}
