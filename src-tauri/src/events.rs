use dbmind_core::types::ColumnMeta;
use serde::Serialize;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
pub struct QueryStartedPayload {
    pub query_id: String,
    pub connection_id: String,
    pub sql: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryReadyPayload {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub row_count: Option<usize>,
    pub execution_time_ms: u64,
    pub affected_rows: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryErrorPayload {
    pub query_id: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryCancelledPayload {
    pub query_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaRefreshedPayload {
    pub database: String,
    pub table_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiTokenPayload {
    pub token: String,
}

pub fn emit_query_started(app: &tauri::AppHandle, payload: QueryStartedPayload) {
    let _ = app.emit("query:started", payload);
}

pub fn emit_query_ready(app: &tauri::AppHandle, payload: QueryReadyPayload) {
    let _ = app.emit("query:ready", payload);
}

pub fn emit_query_error(app: &tauri::AppHandle, payload: QueryErrorPayload) {
    let _ = app.emit("query:error", payload);
}

pub fn emit_query_cancelled(app: &tauri::AppHandle, payload: QueryCancelledPayload) {
    let _ = app.emit("query:cancelled", payload);
}

pub fn emit_schema_refreshed(app: &tauri::AppHandle, payload: SchemaRefreshedPayload) {
    let _ = app.emit("schema:refreshed", payload);
}

pub fn emit_ai_token(app: &tauri::AppHandle, payload: AiTokenPayload) {
    let _ = app.emit("ai:token", payload);
}
