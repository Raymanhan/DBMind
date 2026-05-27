use crate::errors::DbError;
use crate::errors::SchemaError;
use crate::types::*;
use async_trait::async_trait;

/// Database connection manager trait
#[async_trait]
pub trait ConnectionManager: Send + Sync {
    async fn connect(&self, config: &ConnectionConfig) -> Result<String, DbError>;
    async fn disconnect(&self, connection_id: &str) -> Result<(), DbError>;
    async fn test_connection(&self, config: &ConnectionConfig) -> Result<bool, DbError>;
    fn active_connections(&self) -> Vec<String>;
}

/// Query executor trait - streaming/async query execution
#[async_trait]
pub trait QueryExecutor: Send + Sync {
    async fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResultMeta, DbError>;

    async fn cancel_query(&self, query_id: &str) -> Result<(), DbError>;

    async fn fetch_cells(
        &self,
        query_id: &str,
        row_start: usize,
        row_end: usize,
        col_start: usize,
        col_end: usize,
    ) -> Result<CellBlock, DbError>;
}

/// Schema provider trait
#[async_trait]
pub trait SchemaProvider: Send + Sync {
    async fn get_schema(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<Vec<TableSchema>, SchemaError>;

    async fn get_table(
        &self,
        connection_id: &str,
        database: &str,
        table: &str,
    ) -> Result<TableSchema, SchemaError>;

    async fn search_tables(
        &self,
        connection_id: &str,
        query: &str,
    ) -> Result<Vec<TableBrief>, SchemaError>;

    async fn refresh_schema(&self, connection_id: &str, database: &str) -> Result<(), SchemaError>;
}
