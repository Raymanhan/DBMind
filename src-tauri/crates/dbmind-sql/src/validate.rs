/// Validate SQL and return warnings for destructive operations
pub fn validate_sql(sql: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    let upper = sql.to_uppercase();

    // Check for destructive DDL patterns
    let checks: &[(&str, &str)] = &[
        ("DROP TABLE", "This will permanently delete a table"),
        ("DROP DATABASE", "This will permanently delete a database"),
        ("TRUNCATE", "This will remove all rows from a table"),
    ];

    for (pattern, warning) in checks {
        if upper.contains(pattern) {
            warnings.push(warning.to_string());
        }
    }

    // ALTER TABLE ... DROP needs special handling (two parts)
    if upper.contains("ALTER TABLE") && upper.contains("DROP") {
        warnings.push("This will remove a column or constraint".to_string());
    }

    // DELETE without WHERE is dangerous
    if upper.contains("DELETE FROM") && !upper.contains("WHERE") {
        warnings.push("DELETE without WHERE will delete all rows".to_string());
    }

    // UPDATE without WHERE is dangerous
    if upper.contains("UPDATE ") && !upper.contains(" WHERE ") {
        warnings.push("UPDATE without WHERE will update all rows".to_string());
    }

    warnings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_drop_table_warning() {
        let warnings = validate_sql("DROP TABLE users;");
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn test_select_no_warning() {
        let warnings = validate_sql("SELECT * FROM users;");
        assert!(warnings.is_empty());
    }

    #[test]
    fn test_alter_drop_warning() {
        let warnings = validate_sql("ALTER TABLE users DROP COLUMN age;");
        assert!(warnings.iter().any(|w| w.contains("column")));
    }

    #[test]
    fn test_delete_without_where() {
        let warnings = validate_sql("DELETE FROM users;");
        assert!(warnings.iter().any(|w| w.contains("DELETE")));
    }
}
