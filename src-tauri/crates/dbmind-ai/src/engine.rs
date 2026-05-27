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

    /// Construct the final prompt for the LLM
    pub fn construct_sql_prompt(&self, context: &AiContextBundle, user_question: &str) -> String {
        let mut prompt = String::from("You are DBMind, an AI SQL assistant.\n\n");

        prompt.push_str(&format!("Database: {}\n\n", context.database));

        if !context.schema.tables.is_empty() {
            prompt.push_str("Schema:\n");
            for table in &context.schema.tables {
                prompt.push_str(&format!(
                    "  {} ({} rows)",
                    table.name,
                    table.row_count.unwrap_or(0)
                ));
                if let Some(ref comment) = table.comment {
                    prompt.push_str(&format!(" - {}", comment));
                }
                prompt.push('\n');
                for col in &table.columns {
                    prompt.push_str(&format!("    {}: {}", col.name, col.data_type));
                    if let Some(ref comment) = col.comment {
                        prompt.push_str(&format!(" ({})", comment));
                    }
                    prompt.push('\n');
                }
            }
            prompt.push('\n');
        }

        if let Some(ref sql) = context.current_sql {
            prompt.push_str(&format!("Current SQL:\n{}\n\n", sql));
        }

        if let Some(ref err) = context.error {
            prompt.push_str(&format!("Error:\n{}\n\n", err));
        }

        prompt.push_str(&format!("Question: {}\n\nAnswer:", user_question));

        prompt
    }
}

pub struct AiContextBundle {
    pub schema: SchemaSummary,
    pub current_sql: Option<String>,
    pub error: Option<String>,
    pub database: String,
}
