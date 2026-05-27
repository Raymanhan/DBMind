use crate::events;
use crate::AppState;
use dbmind_core::types::{CrossDbTableBrief, DatabaseDriver, TableBrief, TableSchema};
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

    // Detect driver type from schema's database — default to MySQL
    let driver_type = if schema.schema.is_some() {
        DatabaseDriver::Postgres
    } else {
        DatabaseDriver::Mysql
    };

    Ok(build_ddl(&schema, driver_type))
}

fn build_ddl(schema: &TableSchema, driver_type: DatabaseDriver) -> String {
    match driver_type {
        DatabaseDriver::Postgres => build_pg_ddl(schema),
        _ => build_mysql_ddl(schema),
    }
}

fn build_mysql_ddl(schema: &TableSchema) -> String {
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

fn build_pg_ddl(schema: &TableSchema) -> String {
    let qualified = match &schema.schema {
        Some(s) => format!("{}.{}", s, schema.table),
        None => schema.table.clone(),
    };

    let mut lines = vec![format!("CREATE TABLE {} (", qualified)];
    for (i, col) in schema.columns.iter().enumerate() {
        let mut def = format!("  {} {}", pg_quote(&col.name), pg_type(&col.data_type));
        if !col.nullable {
            def.push_str(" NOT NULL");
        }
        if let Some(ref dv) = col.default_value {
            def.push_str(&format!(" DEFAULT {}", dv));
        }
        if i < schema.columns.len() - 1 {
            def.push(',');
        }
        lines.push(def);
    }
    lines.push(")".to_string());
    let ddl = lines.join("\n");

    // Add table comment as separate statement
    let mut result = format!("{};", ddl);
    if let Some(ref c) = schema.comment {
        if !c.is_empty() {
            result.push_str(&format!(
                "\n\nCOMMENT ON TABLE {} IS '{}';",
                qualified,
                c.replace('\'', "''")
            ));
        }
    }
    // Add column comments
    for col in &schema.columns {
        if let Some(ref c) = col.comment {
            if !c.is_empty() {
                result.push_str(&format!(
                    "\nCOMMENT ON COLUMN {}.{} IS '{}';",
                    qualified,
                    pg_quote(&col.name),
                    c.replace('\'', "''")
                ));
            }
        }
    }
    result
}

/// Quote a PG identifier if needed
fn pg_quote(name: &str) -> String {
    if name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && !name.is_empty() {
        // Check for reserved words — just quote everything to be safe
        let lower = name.to_lowercase();
        let reserved = [
            "user", "order", "group", "select", "table", "index", "column",
            "primary", "key", "default", "check", "constraint", "foreign",
            "references", "unique", "values", "set", "from", "where",
        ];
        if reserved.contains(&lower.as_str()) {
            format!("\"{}\"", name)
        } else {
            name.to_string()
        }
    } else {
        format!("\"{}\"", name)
    }
}

/// Map PG data types to proper DDL representation
fn pg_type(data_type: &str) -> &str {
    match data_type.to_lowercase().as_str() {
        "integer" | "int" | "int4" => "integer",
        "bigint" | "int8" => "bigint",
        "smallint" | "int2" => "smallint",
        "double precision" | "float8" => "double precision",
        "real" | "float4" => "real",
        "numeric" => "numeric",
        "character varying" | "varchar" => "character varying",
        "character" | "bpchar" | "char" => "character",
        "text" => "text",
        "boolean" | "bool" => "boolean",
        "date" => "date",
        "timestamp without time zone" | "timestamp" => "timestamp without time zone",
        "timestamp with time zone" | "timestamptz" => "timestamp with time zone",
        "time without time zone" | "time" => "time without time zone",
        "time with time zone" | "timetz" => "time with time zone",
        "uuid" => "uuid",
        "json" => "json",
        "jsonb" => "jsonb",
        "bytea" => "bytea",
        "inet" => "inet",
        "cidr" => "cidr",
        "macaddr" => "macaddr",
        "interval" => "interval",
        _ => data_type,
    }
}
