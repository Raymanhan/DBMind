use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;
use uuid::Uuid;

use dbmind_cache::store::ResultStore;
use dbmind_core::errors::DbError;
use dbmind_core::traits::QueryExecutor;
use dbmind_core::types::*;
use dbmind_db::manager::ConnectionManagerImpl;

/// Query executor that bridges connections and result store
pub struct QueryExecutorImpl {
    conn_manager: Arc<ConnectionManagerImpl>,
    result_store: Arc<ResultStore>,
    active_queries: RwLock<HashMap<String, String>>,
    cancelled_queries: RwLock<HashSet<String>>,
}

impl QueryExecutorImpl {
    pub fn new(conn_manager: Arc<ConnectionManagerImpl>, result_store: Arc<ResultStore>) -> Self {
        Self {
            conn_manager,
            result_store,
            active_queries: RwLock::new(HashMap::new()),
            cancelled_queries: RwLock::new(HashSet::new()),
        }
    }

    pub async fn is_cancelled(&self, query_id: &str) -> bool {
        self.cancelled_queries.read().await.contains(query_id)
    }

    pub async fn execute_query_with_id(
        &self,
        query_id: String,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResultMeta, DbError> {
        let start = Instant::now();

        let stmts = dbmind_sql::split::split_statements(sql);
        if stmts.is_empty() {
            return Err(DbError::InvalidQuery("No SQL statements found".into()));
        }

        self.active_queries
            .write()
            .await
            .insert(query_id.clone(), connection_id.to_string());
        if self.is_cancelled(&query_id).await {
            self.active_queries.write().await.remove(&query_id);
            return Ok(QueryResultMeta {
                query_id,
                columns: vec![],
                status: QueryStatus::Cancelled,
                row_count: None,
                execution_time_ms: Some(start.elapsed().as_millis() as u64),
                error: None,
                affected_rows: None,
            });
        }

        let result = match self
            .conn_manager
            .exec_sql_with_query_id(connection_id, &query_id, sql)
            .await
        {
            Ok(result) => result,
            Err(e) => {
                self.active_queries.write().await.remove(&query_id);
                if self.is_cancelled(&query_id).await {
                    self.result_store.remove(&query_id).await;
                    return Ok(QueryResultMeta {
                        query_id,
                        columns: vec![],
                        status: QueryStatus::Cancelled,
                        row_count: None,
                        execution_time_ms: Some(start.elapsed().as_millis() as u64),
                        error: None,
                        affected_rows: None,
                    });
                }
                return Err(DbError::QueryFailed(format!("Execution failed: {}", e)));
            }
        };

        if self.is_cancelled(&query_id).await {
            self.active_queries.write().await.remove(&query_id);
            self.result_store.remove(&query_id).await;
            return Ok(QueryResultMeta {
                query_id,
                columns: vec![],
                status: QueryStatus::Cancelled,
                row_count: None,
                execution_time_ms: Some(start.elapsed().as_millis() as u64),
                error: None,
                affected_rows: None,
            });
        }

        let row_count = if result.rows.is_empty() {
            result.affected_rows.map(|n| n as usize)
        } else {
            Some(result.rows.len())
        };

        let columns = result.columns.clone();
        self.result_store
            .store(&query_id, result.columns, result.rows)
            .await;

        self.active_queries.write().await.remove(&query_id);

        let elapsed = start.elapsed().as_millis() as u64;
        Ok(QueryResultMeta {
            query_id,
            columns,
            status: QueryStatus::Ready,
            row_count,
            execution_time_ms: Some(elapsed),
            error: None,
            affected_rows: result.affected_rows,
        })
    }
}

#[async_trait::async_trait]
impl QueryExecutor for QueryExecutorImpl {
    async fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResultMeta, DbError> {
        let query_id = Uuid::new_v4().to_string();
        self.execute_query_with_id(query_id, connection_id, sql)
            .await
    }

    async fn cancel_query(&self, query_id: &str) -> Result<(), DbError> {
        self.cancelled_queries
            .write()
            .await
            .insert(query_id.to_string());
        let connection_id = self.active_queries.write().await.remove(query_id);
        if let Some(connection_id) = connection_id {
            self.conn_manager
                .cancel_query(&connection_id, query_id)
                .await?;
        }
        self.result_store.remove(query_id).await;
        Ok(())
    }

    async fn fetch_cells(
        &self,
        query_id: &str,
        row_start: usize,
        row_end: usize,
        col_start: usize,
        col_end: usize,
    ) -> Result<CellBlock, DbError> {
        self.result_store
            .fetch_block(query_id, row_start, row_end, col_start, col_end)
            .await
            .ok_or_else(|| DbError::QueryFailed("Query result not found".into()))
    }
}
