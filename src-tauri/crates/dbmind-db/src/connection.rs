use async_trait::async_trait;
use dbmind_core::errors::DbError;
use dbmind_core::types::{CellValue, ColumnMeta, ConnectionConfig, DatabaseDriver};

/// Unified query result from any database driver
#[derive(Debug)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<CellValue>>,
    pub affected_rows: Option<u64>,
    pub execution_time_ms: u64,
}

/// Database driver trait - abstraction over mysql_async / tokio-postgres
#[async_trait]
pub trait Driver: Send + Sync {
    async fn connect(&self, config: &ConnectionConfig) -> Result<(), DbError>;
    async fn disconnect(&self) -> Result<(), DbError>;
    async fn exec(&self, sql: &str) -> Result<QueryResult, DbError>;
    async fn exec_with_query_id(&self, _query_id: &str, sql: &str) -> Result<QueryResult, DbError> {
        self.exec(sql).await
    }
    async fn cancel_query(&self, _query_id: &str) -> Result<(), DbError> {
        Ok(())
    }
    async fn is_connected(&self) -> bool;
    fn driver_type(&self) -> DatabaseDriver;
    fn schema(&self) -> &str;
}
