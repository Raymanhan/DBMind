use std::sync::Arc;

use crate::index::SchemaIndex;
use dbmind_core::errors::SchemaError;
use dbmind_core::types::*;
use dbmind_db::manager::ConnectionManagerImpl;

/// Refreshes the schema index from database connections
pub struct SchemaRefresh {
    index: Arc<SchemaIndex>,
    conn_manager: Arc<ConnectionManagerImpl>,
}

impl SchemaRefresh {
    pub fn new(index: Arc<SchemaIndex>, conn_manager: Arc<ConnectionManagerImpl>) -> Self {
        Self {
            index,
            conn_manager,
        }
    }

    /// Full refresh: read all tables from the database and store in index
    pub async fn full_refresh(
        &self,
        connection_id: &str,
        database: &str,
    ) -> Result<(), SchemaError> {
        let driver_type = self
            .conn_manager
            .driver_type(connection_id)
            .await
            .ok_or_else(|| SchemaError::ReadFailed("Connection not found".into()))?;

        let schema_sql = match driver_type {
            DatabaseDriver::Mysql => mysql_schema_query(database),
            DatabaseDriver::Postgres => postgres_schema_query(database),
            DatabaseDriver::Sqlite => {
                return Err(SchemaError::ReadFailed("SQLite not supported".into()))
            }
        };

        let result = self
            .conn_manager
            .exec_sql(connection_id, &schema_sql)
            .await
            .map_err(|e| SchemaError::ReadFailed(e.to_string()))?;

        let tables = match driver_type {
            DatabaseDriver::Mysql => parse_mysql_schema(database, result.rows),
            DatabaseDriver::Postgres => parse_postgres_schema(database, result.rows),
            DatabaseDriver::Sqlite => vec![],
        };

        for table in tables {
            self.index.store_table(table).await;
        }

        Ok(())
    }

    /// Incremental refresh: only update changed tables
    pub async fn incremental_refresh(
        &self,
        _connection_id: &str,
        _database: &str,
        tables: Vec<TableSchema>,
    ) -> Result<(), SchemaError> {
        for table in tables {
            self.index.store_table(table).await;
        }
        Ok(())
    }
}

fn mysql_schema_query(database: &str) -> String {
    format!(
        "SELECT \
         t.TABLE_NAME, t.TABLE_TYPE, t.TABLE_COMMENT, t.TABLE_ROWS, \
         c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, \
         c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_SCALE, c.COLUMN_COMMENT, c.COLUMN_KEY, c.EXTRA \
         FROM INFORMATION_SCHEMA.TABLES t \
         JOIN INFORMATION_SCHEMA.COLUMNS c \
           ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME \
         WHERE t.TABLE_SCHEMA = '{}' AND t.TABLE_TYPE = 'BASE TABLE' \
         ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION",
        sanitize_sql_string(database)
    )
}

fn postgres_schema_query(database: &str) -> String {
    format!(
        "SELECT c.table_name, 'BASE TABLE' as table_type, \
         obj_description(pgc.oid) as table_comment, \
         (SELECT reltuples::bigint FROM pg_class WHERE oid = c.table_name::regclass) as table_rows, \
         c.column_name, c.data_type, c.is_nullable, c.column_default, \
         c.character_maximum_length, c.numeric_scale, \
         pgd.description as column_comment, \
         CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END as column_key, \
         '' as extra \
         FROM information_schema.columns c \
         LEFT JOIN pg_catalog.pg_description pgd \
           ON pgd.objsubid = c.ordinal_position \
           AND pgd.objoid = (SELECT oid FROM pg_class WHERE relname = c.table_name) \
         LEFT JOIN pg_class pgc ON pgc.relname = c.table_name \
         LEFT JOIN ( \
           SELECT kcu.column_name, kcu.table_name \
           FROM information_schema.table_constraints tc \
           JOIN information_schema.key_column_usage kcu \
             ON tc.constraint_name = kcu.constraint_name \
           WHERE tc.constraint_type = 'PRIMARY KEY' \
         ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name \
         WHERE c.table_schema = 'public' AND c.table_catalog = '{}' \
         ORDER BY c.table_name, c.ordinal_position",
        sanitize_sql_string(database)
    )
}

/// Sanitize a value for safe embedding inside a SQL single-quoted string literal.
/// Removes all single-quote characters to eliminate injection risk.
fn sanitize_sql_string(input: &str) -> String {
    input.replace('\'', "")
}

fn parse_mysql_schema(database: &str, rows: Vec<Vec<CellValue>>) -> Vec<TableSchema> {
    let mut tables: std::collections::HashMap<String, TableSchema> =
        std::collections::HashMap::new();

    for row in &rows {
        if row.len() < 13 {
            continue;
        }

        let table_name = cell_to_string(&row[0]);
        let entry = tables
            .entry(table_name.clone())
            .or_insert_with(|| TableSchema {
                database: database.to_string(),
                schema: None,
                table: table_name.clone(),
                table_type: cell_to_string(&row[1]),
                columns: vec![],
                indexes: vec![],
                foreign_keys: vec![],
                row_count: cell_to_string(&row[3]).parse().ok(),
                comment: opt_cell_to_string(&row[2]),
            });

        let is_primary = cell_to_string(&row[11]) == "PRI";
        entry.columns.push(ColumnMeta {
            name: cell_to_string(&row[4]),
            data_type: cell_to_string(&row[5]),
            nullable: cell_to_string(&row[6]) == "YES",
            is_primary_key: is_primary,
            default_value: opt_cell_to_string(&row[7]),
            comment: opt_cell_to_string(&row[10]),
            max_length: cell_to_string(&row[8]).parse().ok(),
            decimal_digits: cell_to_string(&row[9]).parse().ok(),
        });
    }

    tables.into_values().collect()
}

fn parse_postgres_schema(database: &str, rows: Vec<Vec<CellValue>>) -> Vec<TableSchema> {
    let mut tables: std::collections::HashMap<String, TableSchema> =
        std::collections::HashMap::new();

    for row in &rows {
        if row.len() < 13 {
            continue;
        }

        let table_name = cell_to_string(&row[0]);
        let entry = tables
            .entry(table_name.clone())
            .or_insert_with(|| TableSchema {
                database: database.to_string(),
                schema: Some("public".to_string()),
                table: table_name.clone(),
                table_type: cell_to_string(&row[1]),
                columns: vec![],
                indexes: vec![],
                foreign_keys: vec![],
                row_count: cell_to_string(&row[3]).parse().ok(),
                comment: opt_cell_to_string(&row[2]),
            });

        let is_primary = cell_to_string(&row[11]) == "PRI";
        entry.columns.push(ColumnMeta {
            name: cell_to_string(&row[4]),
            data_type: cell_to_string(&row[5]),
            nullable: cell_to_string(&row[6]) == "YES",
            is_primary_key: is_primary,
            default_value: opt_cell_to_string(&row[7]),
            comment: opt_cell_to_string(&row[10]),
            max_length: cell_to_string(&row[8]).parse().ok(),
            decimal_digits: cell_to_string(&row[9]).parse().ok(),
        });
    }

    tables.into_values().collect()
}

fn cell_to_string(cell: &CellValue) -> String {
    match cell {
        CellValue::Null => String::new(),
        CellValue::String(s) => s.clone(),
        CellValue::Int(n) => n.to_string(),
        CellValue::Float(f) => f.to_string(),
        CellValue::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}

fn opt_cell_to_string(cell: &CellValue) -> Option<String> {
    match cell {
        CellValue::Null => None,
        CellValue::String(s) if s.is_empty() => None,
        _ => Some(cell_to_string(cell)),
    }
}
