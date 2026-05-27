use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

/// Split a SQL string into individual statements
pub fn split_statements(sql: &str) -> Vec<String> {
    let dialect = GenericDialect {};
    match Parser::parse_sql(&dialect, sql) {
        Ok(statements) => statements.iter().map(|s| s.to_string()).collect(),
        Err(_) => {
            // Fallback: split by semicolons, preserve original formatting
            sql.split(';')
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .collect()
        }
    }
}

/// Detect which statement the cursor is currently in
pub fn detect_current_statement(sql: &str, offset: usize) -> Option<String> {
    if sql.trim().is_empty() {
        return None;
    }

    let offset = offset.min(sql.len());
    let bytes = sql.as_bytes();
    let mut start = 0usize;
    let mut end = sql.len();
    let mut in_single = false;
    let mut in_double = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut prev = b'\0';

    for (idx, &byte) in bytes.iter().enumerate() {
        let next = bytes.get(idx + 1).copied();

        if in_line_comment {
            if byte == b'\n' {
                in_line_comment = false;
            }
        } else if in_block_comment {
            if prev == b'*' && byte == b'/' {
                in_block_comment = false;
            }
        } else if in_single {
            if byte == b'\'' && prev != b'\\' {
                in_single = false;
            }
        } else if in_double {
            if byte == b'"' && prev != b'\\' {
                in_double = false;
            }
        } else if byte == b'-' && next == Some(b'-') {
            in_line_comment = true;
        } else if byte == b'/' && next == Some(b'*') {
            in_block_comment = true;
        } else if byte == b'\'' {
            in_single = true;
        } else if byte == b'"' {
            in_double = true;
        } else if byte == b';' {
            if idx < offset {
                start = idx + 1;
            } else {
                end = idx;
                break;
            }
        }

        prev = byte;
    }

    let stmt = sql[start..end].trim();
    if stmt.is_empty() {
        None
    } else {
        Some(stmt.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_statement_at_cursor() {
        let sql = "SELECT 1;\nSELECT 2;";
        let offset = sql.find('2').unwrap();
        assert_eq!(
            detect_current_statement(sql, offset),
            Some("SELECT 2".to_string())
        );
    }

    #[test]
    fn ignores_semicolon_inside_string() {
        let sql = "SELECT ';' AS value;\nSELECT 2;";
        let offset = sql.find("value").unwrap();
        assert_eq!(
            detect_current_statement(sql, offset),
            Some("SELECT ';' AS value".to_string())
        );
    }

    #[test]
    fn ignores_semicolon_inside_line_comment() {
        let sql = "SELECT 1 -- ; not a separator\nWHERE true;\nSELECT 2;";
        let offset = sql.find("WHERE").unwrap();
        assert_eq!(
            detect_current_statement(sql, offset),
            Some("SELECT 1 -- ; not a separator\nWHERE true".to_string())
        );
    }

    #[test]
    fn ignores_semicolon_inside_block_comment() {
        let sql = "SELECT /* ; */ 1;\nSELECT 2;";
        let offset = sql.find('1').unwrap();
        assert_eq!(
            detect_current_statement(sql, offset),
            Some("SELECT /* ; */ 1".to_string())
        );
    }
}
