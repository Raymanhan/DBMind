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
            DatabaseDriver::Postgres => postgres_schema_query(database, "public"),
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
            DatabaseDriver::Postgres => parse_postgres_schema(database, "public", result.rows),
            DatabaseDriver::Sqlite => vec![],
        };

        for table in tables {
            self.index.store_table(table).await;
        }

        // For PG, also read indexes and foreign keys
        if driver_type == DatabaseDriver::Postgres {
            self.read_pg_indexes(connection_id, database, "public").await.ok();
            self.read_pg_foreign_keys(connection_id, database, "public").await.ok();
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

    async fn read_pg_indexes(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<(), SchemaError> {
        let sql = format!(
            "SELECT \
             i.relname as index_name, \
             t.relname as table_name, \
             ix.indisunique as is_unique, \
             ix.indisprimary as is_primary, \
             am.amname as index_type, \
             array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) as columns \
             FROM pg_index ix \
             JOIN pg_class t ON t.oid = ix.indrelid \
             JOIN pg_class i ON i.oid = ix.indexrelid \
             JOIN pg_am am ON am.oid = i.relam \
             JOIN pg_namespace nsp ON nsp.oid = t.relnamespace \
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) \
             WHERE nsp.nspname = '{schema}' \
             GROUP BY i.relname, t.relname, ix.indisunique, ix.indisprimary, am.amname",
            schema = sanitize_sql_string(schema)
        );

        let result = self
            .conn_manager
            .exec_sql(connection_id, &sql)
            .await
            .map_err(|e| SchemaError::ReadFailed(e.to_string()))?;

        for row in &result.rows {
            if row.len() < 6 { continue; }
            let table_name = cell_to_string(&row[1]);
            let columns_str = cell_to_string(&row[5]);
            let columns: Vec<String> = columns_str
                .trim_start_matches('{')
                .trim_end_matches('}')
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();

            let index = IndexMeta {
                name: cell_to_string(&row[0]),
                columns,
                unique: cell_to_string(&row[2]) == "t",
                primary: cell_to_string(&row[3]) == "t",
                index_type: cell_to_string(&row[4]),
            };

            self.index.update_table(database, &table_name, |t| t.indexes.push(index)).await;
        }

        Ok(())
    }

    async fn read_pg_foreign_keys(
        &self,
        connection_id: &str,
        database: &str,
        schema: &str,
    ) -> Result<(), SchemaError> {
        let sql = format!(
            "SELECT \
             tc.constraint_name as fk_name, \
             kcu.column_name, \
             ccu.table_name as ref_table, \
             ccu.column_name as ref_column \
             FROM information_schema.table_constraints tc \
             JOIN information_schema.key_column_usage kcu \
               ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
             JOIN information_schema.constraint_column_usage ccu \
               ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema \
             WHERE tc.constraint_type = 'FOREIGN KEY' \
               AND tc.table_schema = '{schema}'",
            schema = sanitize_sql_string(schema)
        );

        let result = self
            .conn_manager
            .exec_sql(connection_id, &sql)
            .await
            .map_err(|e| SchemaError::ReadFailed(e.to_string()))?;

        for row in &result.rows {
            if row.len() < 4 { continue; }
            let fk = ForeignKeyMeta {
                name: cell_to_string(&row[0]),
                column: cell_to_string(&row[1]),
                ref_table: cell_to_string(&row[2]),
                ref_column: cell_to_string(&row[3]),
            };

            let fk_name = fk.name.clone();
            let fk_col = fk.column.clone();
            let tables = self.index.get_database_tables(database).await;
            for table in &tables {
                if table.columns.iter().any(|c| c.name == fk_col) {
                    self.index.update_table(database, &table.table, move |t| {
                        if !t.foreign_keys.iter().any(|existing| existing.name == fk_name) {
                            t.foreign_keys.push(fk);
                        }
                    }).await;
                    break;
                }
            }
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

fn postgres_schema_query(database: &str, schema: &str) -> String {
    format!(
        "SELECT \
         c.table_name, \
         'BASE TABLE' as table_type, \
         obj_description(pgc.oid) as table_comment, \
         pgc.reltuples::bigint as table_rows, \
         c.column_name, \
         c.data_type, \
         c.udt_name as data_type_raw, \
         c.is_nullable, \
         c.column_default, \
         c.character_maximum_length, \
         c.numeric_scale, \
         col_description(pgc.oid, c.ordinal_position) as column_comment, \
         CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END as column_key, \
         CASE WHEN uk.column_name IS NOT NULL THEN 'UNI' ELSE '' END as column_key_uk \
         FROM information_schema.columns c \
         JOIN pg_class pgc ON pgc.relname = c.table_name \
         JOIN pg_namespace nsp ON nsp.oid = pgc.relnamespace AND nsp.nspname = c.table_schema \
         LEFT JOIN ( \
           SELECT kcu.column_name, kcu.table_name, kcu.table_schema \
           FROM information_schema.table_constraints tc \
           JOIN information_schema.key_column_usage kcu \
             ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
           WHERE tc.constraint_type = 'PRIMARY KEY' \
         ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name AND pk.table_schema = c.table_schema \
         LEFT JOIN ( \
           SELECT kcu.column_name, kcu.table_name, kcu.table_schema \
           FROM information_schema.table_constraints tc \
           JOIN information_schema.key_column_usage kcu \
             ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
           WHERE tc.constraint_type = 'UNIQUE' \
         ) uk ON uk.table_name = c.table_name AND uk.column_name = c.column_name AND uk.table_schema = c.table_schema \
         WHERE c.table_schema = '{schema}' AND c.table_catalog = '{db}' \
         ORDER BY c.table_name, c.ordinal_position",
        schema = sanitize_sql_string(schema),
        db = sanitize_sql_string(database)
    )
}

/// Sanitize a value for safe embedding inside a SQL single-quoted string literal.
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

fn parse_postgres_schema(database: &str, schema: &str, rows: Vec<Vec<CellValue>>) -> Vec<TableSchema> {
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
                schema: Some(schema.to_string()),
                table: table_name.clone(),
                table_type: cell_to_string(&row[1]),
                columns: vec![],
                indexes: vec![],
                foreign_keys: vec![],
                row_count: cell_to_string(&row[3]).parse().ok(),
                comment: opt_cell_to_string(&row[2]),
            });

        let is_primary = cell_to_string(&row[12]) == "PRI";
        // Use data_type (human-readable) instead of udt_name for display
        let data_type = cell_to_string(&row[5]);
        let data_type = if data_type.is_empty() { cell_to_string(&row[6]) } else { data_type };

        entry.columns.push(ColumnMeta {
            name: cell_to_string(&row[4]),
            data_type,
            nullable: cell_to_string(&row[7]) == "YES",
            is_primary_key: is_primary,
            default_value: opt_cell_to_string(&row[8]),
            comment: opt_cell_to_string(&row[11]),
            max_length: cell_to_string(&row[9]).parse().ok(),
            decimal_digits: cell_to_string(&row[10]).parse().ok(),
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
