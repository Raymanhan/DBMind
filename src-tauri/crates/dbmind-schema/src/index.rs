use std::collections::HashMap;
use tokio::sync::RwLock;

use dbmind_core::types::*;

/// SQLite-backed schema index for fast metadata access
pub struct SchemaIndex {
    tables: RwLock<HashMap<String, TableSchema>>,
    usage_scores: RwLock<HashMap<String, u64>>,
}

impl SchemaIndex {
    pub fn new() -> Self {
        Self {
            tables: RwLock::new(HashMap::new()),
            usage_scores: RwLock::new(HashMap::new()),
        }
    }

    /// Store table schema into the index
    pub async fn store_table(&self, schema: TableSchema) {
        let key = format!("{}.{}", schema.database, schema.table);
        self.tables.write().await.insert(key, schema);
    }

    /// Store batch schemas
    pub async fn store_tables(&self, schemas: Vec<TableSchema>) {
        let mut tables = self.tables.write().await;
        for schema in schemas {
            let key = format!("{}.{}", schema.database, schema.table);
            tables.insert(key, schema);
        }
    }

    /// Get table schema by name
    pub async fn get_table(&self, database: &str, table: &str) -> Option<TableSchema> {
        let key = format!("{}.{}", database, table);
        let tables = self.tables.read().await;
        tables.get(&key).cloned()
    }

    /// Get all tables for a database
    pub async fn get_database_tables(&self, database: &str) -> Vec<TableSchema> {
        let tables = self.tables.read().await;
        tables
            .iter()
            .filter(|(k, _)| k.starts_with(&format!("{}.", database)))
            .map(|(_, v)| v.clone())
            .collect()
    }

    /// Search tables by name or comment
    pub async fn search_tables(&self, database: &str, query: &str) -> Vec<TableBrief> {
        let lower_query = query.to_lowercase();
        let prefix = format!("{}.", database);
        let tables = self.tables.read().await;

        tables
            .iter()
            .filter(|(k, schema)| {
                k.starts_with(&prefix)
                    && (schema.table.to_lowercase().contains(&lower_query)
                        || schema
                            .comment
                            .as_ref()
                            .map(|c| c.to_lowercase().contains(&lower_query))
                            .unwrap_or(false))
            })
            .map(|(_, schema)| TableBrief {
                name: schema.table.clone(),
                columns: schema
                    .columns
                    .iter()
                    .map(|c| ColumnBrief {
                        name: c.name.clone(),
                        data_type: c.data_type.clone(),
                        comment: c.comment.clone(),
                    })
                    .collect(),
                row_count: schema.row_count,
                comment: schema.comment.clone(),
            })
            .collect()
    }

    /// Record a table access (for usage-based ranking)
    pub async fn record_usage(&self, database: &str, table: &str) {
        let key = format!("{}.{}", database, table);
        let mut scores = self.usage_scores.write().await;
        *scores.entry(key).or_insert(0) += 1;
    }

    /// Get most used tables for a database
    pub async fn get_most_used(&self, database: &str, limit: usize) -> Vec<TableBrief> {
        let scores = self.usage_scores.read().await;
        let tables = self.tables.read().await;

        let mut scored: Vec<(&String, u64)> = scores
            .iter()
            .filter(|(k, _)| k.starts_with(&format!("{}.", database)))
            .map(|(k, v)| (k, *v))
            .collect();

        scored.sort_by(|a, b| b.1.cmp(&a.1));

        scored
            .into_iter()
            .take(limit)
            .filter_map(|(k, _)| {
                tables.get(k).map(|schema| TableBrief {
                    name: schema.table.clone(),
                    columns: schema
                        .columns
                        .iter()
                        .map(|c| ColumnBrief {
                            name: c.name.clone(),
                            data_type: c.data_type.clone(),
                            comment: c.comment.clone(),
                        })
                        .collect(),
                    row_count: schema.row_count,
                    comment: schema.comment.clone(),
                })
            })
            .collect()
    }

    /// Build schema summary for AI context
    pub async fn build_ai_context(
        &self,
        database: &str,
        relevant_tables: &[String],
    ) -> SchemaSummary {
        let tables = self.tables.read().await;

        let table_list: Vec<TableBrief> = relevant_tables
            .iter()
            .filter_map(|table_name| {
                let key = format!("{}.{}", database, table_name);
                tables.get(&key).map(|schema| TableBrief {
                    name: schema.table.clone(),
                    columns: schema
                        .columns
                        .iter()
                        .map(|c| ColumnBrief {
                            name: c.name.clone(),
                            data_type: c.data_type.clone(),
                            comment: c.comment.clone(),
                        })
                        .collect(),
                    row_count: schema.row_count,
                    comment: schema.comment.clone(),
                })
            })
            .collect();

        SchemaSummary { tables: table_list }
    }

    /// Search tables across ALL databases by name or comment
    pub async fn search_all_tables(&self, query: &str, limit: usize) -> Vec<CrossDbTableBrief> {
        let lower_query = query.to_lowercase();
        let tables = self.tables.read().await;

        let mut results: Vec<CrossDbTableBrief> = tables
            .iter()
            .filter(|(_, schema)| {
                if lower_query.is_empty() {
                    true
                } else {
                    schema.table.to_lowercase().contains(&lower_query)
                        || schema
                            .comment
                            .as_ref()
                            .map(|c| c.to_lowercase().contains(&lower_query))
                            .unwrap_or(false)
                        || schema.database.to_lowercase().contains(&lower_query)
                }
            })
            .map(|(_, schema)| CrossDbTableBrief {
                database: schema.database.clone(),
                name: schema.table.clone(),
                columns: schema
                    .columns
                    .iter()
                    .map(|c| ColumnBrief {
                        name: c.name.clone(),
                        data_type: c.data_type.clone(),
                        comment: c.comment.clone(),
                    })
                    .collect(),
                row_count: schema.row_count,
                comment: schema.comment.clone(),
            })
            .collect();

        // Sort: exact db match first, then alphabetical by database + table
        results.sort_by(|a, b| {
            a.database.cmp(&b.database).then(a.name.cmp(&b.name))
        });

        results.truncate(limit);
        results
    }

}
