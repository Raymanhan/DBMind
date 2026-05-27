/// Sanitize a value for safe embedding inside a SQL single-quoted string literal.
/// Removes all single-quote characters to eliminate injection risk.
fn sanitize_sql_string(input: &str) -> String {
    input.replace('\'', "")
}

/// Reads schema metadata from MySQL/PostgreSQL via dbmind-db
pub struct SchemaReader;

impl SchemaReader {
    pub fn new() -> Self {
        Self
    }

    /// Build CREATE TABLE-like metadata query for MySQL
    pub fn mysql_schema_query(database: &str) -> String {
        format!(
            r#"
            SELECT
                t.TABLE_NAME,
                t.TABLE_TYPE,
                t.TABLE_COMMENT,
                t.TABLE_ROWS,
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT,
                c.CHARACTER_MAXIMUM_LENGTH,
                c.NUMERIC_SCALE,
                c.COLUMN_COMMENT,
                c.COLUMN_KEY,
                c.EXTRA
            FROM INFORMATION_SCHEMA.TABLES t
            JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME
                AND t.TABLE_SCHEMA = c.TABLE_SCHEMA
            WHERE t.TABLE_SCHEMA = '{}'
                AND t.TABLE_TYPE = 'BASE TABLE'
            ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
            "#,
            sanitize_sql_string(database)
        )
    }

    /// Build schema query for PostgreSQL
    pub fn postgres_schema_query(database: &str, schema: &str) -> String {
        format!(
            r#"
            SELECT
                c.table_name,
                c.column_name,
                c.data_type,
                c.is_nullable,
                c.column_default,
                c.character_maximum_length,
                c.numeric_precision,
                pgd.description as column_comment
            FROM information_schema.columns c
            LEFT JOIN pg_catalog.pg_statio_all_tables st
                ON c.table_name = st.relname
            LEFT JOIN pg_catalog.pg_description pgd
                ON pgd.objsubid = c.ordinal_position
                AND pgd.objoid = st.relid
            WHERE c.table_schema = '{}'
                AND c.table_catalog = '{}'
            ORDER BY c.table_name, c.ordinal_position
            "#,
            sanitize_sql_string(schema),
            sanitize_sql_string(database)
        )
    }
}
