use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

/// Format SQL string with basic indentation and keyword capitalization
pub fn format_sql(sql: &str) -> Result<String, String> {
    let dialect = GenericDialect {};
    let statements = Parser::parse_sql(&dialect, sql).map_err(|e| format!("Parse error: {}", e))?;

    Ok(statements
        .iter()
        .map(|s| prettify_sql(&s.to_string()))
        .collect::<Vec<_>>()
        .join(";\n\n"))
}

fn prettify_sql(sql: &str) -> String {
    // Major clause keywords that should appear on their own line
    let major_clauses = [
        "FROM",
        "WHERE",
        "AND ",
        "OR ",
        "INNER JOIN",
        "LEFT JOIN",
        "RIGHT JOIN",
        "FULL JOIN",
        "CROSS JOIN",
        "ON ",
        "ORDER BY",
        "GROUP BY",
        "HAVING",
        "LIMIT",
        "OFFSET",
        "UNION",
        "INTERSECT",
        "EXCEPT",
        "VALUES",
        "SET ",
    ];

    let mut result = sql.to_string();

    // Capitalize common keywords
    for kw in &[
        "select ",
        "from ",
        "where ",
        "insert ",
        "update ",
        "delete ",
        "create ",
        "alter ",
        "drop ",
        "join ",
        "inner join ",
        "left join ",
        "right join ",
        "order by ",
        "group by ",
        "having ",
        "limit ",
        "values ",
        "set ",
        "as ",
        "on ",
        "and ",
        "or ",
        "not ",
        "null",
        "is null",
        "distinct ",
        "count(",
        "sum(",
        "avg(",
        "max(",
        "min(",
    ] {
        let upper = kw.to_uppercase();
        result = result.replace(kw, &upper);
    }

    // Insert newlines before major clauses
    for clause in &major_clauses {
        // Match clause after whitespace (not at start of line)
        let pattern = format!(" {}", clause.to_lowercase());
        if let Some(pos) = result.to_lowercase().find(&pattern) {
            // Only add newline if not already preceded by newline
            let reinsert = format!("\n{}", clause);
            if !result[..pos].ends_with('\n') {
                result = result.replacen(&pattern, &reinsert, 1);
            }
        }
    }

    result
}
