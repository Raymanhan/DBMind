use crate::events;
use crate::AppState;
use dbmind_core::types::{ColumnMeta, CrossDbTableBrief, TableBrief, TableSchema};
use tauri::State;

#[tauri::command]
pub async fn get_schema(
    state: State<'_, AppState>,
    database: String,
    table: Option<String>,
) -> Result<Vec<TableSchema>, String> {
    let tables = state.schema_index.get_database_tables(&database).await;

    if let Some(ref t) = table {
        Ok(tables.into_iter().filter(|s| s.table == *t).collect())
    } else {
        Ok(tables)
    }
}

#[tauri::command]
pub async fn search_tables(
    state: State<'_, AppState>,
    database: String,
    query: String,
) -> Result<Vec<TableBrief>, String> {
    Ok(state.schema_index.search_tables(&database, &query).await)
}

#[tauri::command]
pub async fn refresh_schema(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
    database: String,
) -> Result<(), String> {
    state
        .schema_refresh
        .full_refresh(&connection_id, &database)
        .await
        .map_err(|e| e.to_string())?;

    let table_count = state
        .schema_index
        .get_database_tables(&database)
        .await
        .len();
    events::emit_schema_refreshed(
        &app,
        events::SchemaRefreshedPayload {
            database,
            table_count,
        },
    );

    Ok(())
}


#[tauri::command]
pub async fn search_all_tables(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<CrossDbTableBrief>, String> {
    Ok(state.schema_index.search_all_tables(&query, 50).await)
}

#[tauri::command]
pub async fn generate_ddl(
    state: State<'_, AppState>,
    database: String,
    table: String,
) -> Result<String, String> {
    let schema = state
        .schema_index
        .get_table(&database, &table)
        .await
        .ok_or_else(|| format!("Table {}.{} not found", database, table))?;
    Ok(build_ddl(&schema))
}

fn build_ddl(schema: &TableSchema) -> String {
    let mut lines = vec![format!("CREATE TABLE `{}` (", schema.table)];
    for (i, col) in schema.columns.iter().enumerate() {
        let mut def = format!("  `{}` {}", col.name, col.data_type);
        if !col.nullable {
            def.push_str(" NOT NULL");
        }
        if col.is_primary_key {
            def.push_str(" PRIMARY KEY");
        }
        if let Some(ref dv) = col.default_value {
            def.push_str(&format!(" DEFAULT {}", dv));
        }
        if let Some(ref c) = col.comment {
            if !c.is_empty() {
                def.push_str(&format!(" COMMENT '{}'", c.replace('\'', "''")));
            }
        }
        if i < schema.columns.len() - 1 {
            def.push(',');
        }
        lines.push(def);
    }
    lines.push(")".to_string());
    if let Some(ref c) = schema.comment {
        if !c.is_empty() {
            lines.push(format!("COMMENT='{}'", c.replace('\'', "''")));
        }
    }
    let ddl = lines.join("\n");
    format!("{};", ddl)
}
