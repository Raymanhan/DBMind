#[tauri::command]
pub async fn format_sql(sql: String) -> Result<String, String> {
    dbmind_sql::format::format_sql(&sql)
}

#[tauri::command]
pub async fn split_sql(sql: String) -> Vec<String> {
    dbmind_sql::split::split_statements(&sql)
}

#[tauri::command]
pub async fn current_statement(sql: String, offset: usize) -> Option<String> {
    dbmind_sql::split::detect_current_statement(&sql, offset)
}

#[tauri::command]
pub async fn validate_sql(sql: String) -> Vec<String> {
    dbmind_sql::validate::validate_sql(&sql)
}

#[tauri::command]
pub async fn extract_tables(sql: String) -> Vec<String> {
    dbmind_sql::extract::extract_table_references(&sql)
}
