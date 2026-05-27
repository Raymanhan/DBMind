use sqlparser::ast::{SetExpr, Statement, TableFactor, TableWithJoins};
use sqlparser::dialect::GenericDialect;
use sqlparser::parser::Parser;

/// Extract table references from SQL
pub fn extract_table_references(sql: &str) -> Vec<String> {
    let dialect = GenericDialect {};
    let mut tables = Vec::new();

    let Ok(statements) = Parser::parse_sql(&dialect, sql) else {
        return tables;
    };

    for stmt in &statements {
        match stmt {
            Statement::Query(query) => {
                extract_from_query(&query.body, &mut tables);
            }
            Statement::Insert(insert) => {
                tables.push(insert.table_name.to_string());
            }
            Statement::Update { table, .. } => {
                if let TableFactor::Table { name, .. } = &table.relation {
                    tables.push(name.to_string());
                }
            }
            Statement::Delete(delete) => {
                for table in &delete.tables {
                    tables.push(table.to_string());
                }
            }
            _ => {}
        }
    }

    tables
}

fn extract_from_query(set_expr: &SetExpr, tables: &mut Vec<String>) {
    match set_expr {
        SetExpr::Select(select) => {
            for item in &select.from {
                extract_table_from_join(item, tables);
            }
        }
        SetExpr::SetOperation { left, right, .. } => {
            extract_from_query(left, tables);
            extract_from_query(right, tables);
        }
        SetExpr::Query(query) => {
            extract_from_query(&query.body, tables);
        }
        _ => {}
    }
}

fn extract_table_from_join(table_with_joins: &TableWithJoins, tables: &mut Vec<String>) {
    if let TableFactor::Table { name, .. } = &table_with_joins.relation {
        tables.push(name.to_string());
    }
    for join in &table_with_joins.joins {
        if let TableFactor::Table { name, .. } = &join.relation {
            tables.push(name.to_string());
        }
    }
}
