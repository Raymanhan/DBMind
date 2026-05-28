use dbmind_core::types::*;
use dbmind_schema::index::SchemaIndex;
use std::sync::Arc;

/// AI context engine - constructs prompts server-side
pub struct AiContextEngine {
    schema_index: Arc<SchemaIndex>,
}

impl AiContextEngine {
    pub fn new(schema_index: Arc<SchemaIndex>) -> Self {
        Self { schema_index }
    }

    /// Build prompt context from current workspace state
    pub async fn build_context(
        &self,
        database: &str,
        current_sql: Option<&str>,
        mentioned_tables: &[String],
        error: Option<&str>,
    ) -> AiContextBundle {
        let relevant = if mentioned_tables.is_empty() {
            self.schema_index
                .get_most_used(database, 10)
                .await
                .into_iter()
                .map(|t| t.name)
                .collect()
        } else {
            mentioned_tables.to_vec()
        };

        let summary = self
            .schema_index
            .build_ai_context(database, &relevant)
            .await;

        AiContextBundle {
            schema: summary,
            current_sql: current_sql.map(|s| s.to_string()),
            error: error.map(|e| e.to_string()),
            database: database.to_string(),
        }
    }
}

pub struct AiContextBundle {
    pub schema: SchemaSummary,
    pub current_sql: Option<String>,
    pub error: Option<String>,
    pub database: String,
}
