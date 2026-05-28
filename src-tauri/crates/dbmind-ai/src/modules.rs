use crate::engine::AiContextBundle;

/// Construct prompt for NL2SQL
pub fn nl2sql_prompt(context: &AiContextBundle, question: &str) -> String {
    let mut prompt = String::new();

    if !context.schema.tables.is_empty() {
        prompt.push_str("## Available Table Schemas (use ONLY these columns)\n\n");
        for table in &context.schema.tables {
            prompt.push_str(&format!("### `{}`.`{}`\n", context.database, table.name));
            for col in &table.columns {
                let mut parts = format!("- `{}` {}", col.name, col.data_type);
                if let Some(ref comment) = col.comment {
                    if !comment.is_empty() {
                        parts.push_str(&format!(" -- {}", comment));
                    }
                }
                prompt.push_str(&parts);
                prompt.push('\n');
            }
            if let Some(row_count) = table.row_count {
                prompt.push_str(&format!("(~{} rows)\n", row_count));
            }
            prompt.push('\n');
        }
    }

    prompt.push_str(&format!("## User Question\n{}\n\n", question));
    prompt.push_str("Analyze the question, then output the SQL in a ```sql code block. Rules:
- Only use columns that exist in the schemas above.
- ALL table references must be fully qualified (database.table), never bare table names.
- Use the identifier quoting style appropriate for the database type as specified in the system prompt.");

    prompt
}

/// Construct prompt for SQL EXPLAIN
pub fn sql_explain_prompt(sql: &str) -> String {
    format!(
        "Analyze the following SQL query:\n\n\
        ```sql\n{}\n```\n\n\
        Explain in concise terms:\n\
        1. What this query does\n\
        2. Which tables are involved\n\
        3. Key filters and join conditions\n\
        4. Performance notes if applicable\n",
        sql
    )
}

