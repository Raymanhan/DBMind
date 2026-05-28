use std::sync::Arc;

use dbmind_ai::engine::AiContextEngine;
use dbmind_cache::store::ResultStore;
use dbmind_db::manager::ConnectionManagerImpl;
use dbmind_query::executor::QueryExecutorImpl;
use dbmind_query::service::QueryService;
use dbmind_schema::index::SchemaIndex;
use dbmind_schema::refresh::SchemaRefresh;

mod commands;
pub mod events;

/// Application state shared across Tauri commands
pub struct AppState {
    pub conn_manager: Arc<ConnectionManagerImpl>,
    pub query_service: Arc<QueryService>,
    pub schema_index: Arc<SchemaIndex>,
    pub schema_refresh: Arc<SchemaRefresh>,
    pub ai_engine: Arc<AiContextEngine>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let schema_index = Arc::new(SchemaIndex::new());
    let conn_manager = Arc::new(ConnectionManagerImpl::new());
    let result_store = Arc::new(ResultStore::new());
    let query_executor = Arc::new(QueryExecutorImpl::new(
        conn_manager.clone(),
        result_store.clone(),
    ));
    let query_service = Arc::new(QueryService::new(query_executor.clone()));
    let schema_refresh = Arc::new(SchemaRefresh::new(
        schema_index.clone(),
        conn_manager.clone(),
    ));
    let ai_engine = Arc::new(AiContextEngine::new(schema_index.clone()));

    let state = AppState {
        conn_manager,
        query_service,
        schema_index,
        schema_refresh,
        ai_engine,
    };

    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            commands::connections::connect,
            commands::connections::disconnect,
            commands::connections::test_connection,
            commands::connections::list_connections,
            commands::connections::delete_connection,
            commands::connections::list_databases,
            commands::query::execute_query,
            commands::query::fetch_cells,
            commands::query::cancel_query,
            commands::schema::get_schema,
            commands::schema::search_tables,
            commands::schema::search_all_tables,
            commands::schema::refresh_schema,
            commands::schema::generate_ddl,
            commands::ai::chat,
            commands::ai::nl2sql,
            commands::ai::explain_sql,
            commands::sql::format_sql,
            commands::sql::split_sql,
            commands::sql::current_statement,
            commands::sql::validate_sql,
            commands::sql::extract_tables,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
