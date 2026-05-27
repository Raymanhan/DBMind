use std::sync::Arc;

use crate::executor::QueryExecutorImpl;
use dbmind_core::errors::DbError;
use dbmind_core::traits::QueryExecutor;
use dbmind_core::types::*;

/// High-level query service exposed via Tauri commands
pub struct QueryService {
    executor: Arc<QueryExecutorImpl>,
}

impl QueryService {
    pub fn new(executor: Arc<QueryExecutorImpl>) -> Self {
        Self { executor }
    }

    pub async fn execute(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResultMeta, DbError> {
        let warnings = dbmind_sql::validate::validate_sql(sql);
        for w in &warnings {
            log::warn!("SQL safety warning: {}", w);
        }

        self.executor.execute_query(connection_id, sql).await
    }

    pub async fn execute_with_id(
        &self,
        query_id: String,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResultMeta, DbError> {
        let warnings = dbmind_sql::validate::validate_sql(sql);
        for w in &warnings {
            log::warn!("SQL safety warning: {}", w);
        }

        self.executor
            .execute_query_with_id(query_id, connection_id, sql)
            .await
    }

    pub async fn fetch_cells(
        &self,
        query_id: &str,
        row_start: usize,
        row_end: usize,
        col_start: usize,
        col_end: usize,
    ) -> Result<CellBlock, DbError> {
        self.executor
            .fetch_cells(query_id, row_start, row_end, col_start, col_end)
            .await
    }

    pub async fn cancel(&self, query_id: &str) -> Result<(), DbError> {
        self.executor.cancel_query(query_id).await
    }

    pub async fn is_cancelled(&self, query_id: &str) -> bool {
        self.executor.is_cancelled(query_id).await
    }
}
