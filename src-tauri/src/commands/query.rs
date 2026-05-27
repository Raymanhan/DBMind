use crate::events;
use crate::AppState;
use dbmind_core::types::*;
use tauri::State;

#[tauri::command]
pub async fn execute_query(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
    sql: String,
    query_id: Option<String>,
) -> Result<QueryResultMeta, String> {
    // Pre-process SQL: backtick-quote identifiers with hyphens (MySQL only)
    let quoted_sql = match state.conn_manager.driver_type(&connection_id).await {
        Some(DatabaseDriver::Mysql) => dbmind_sql::quote::quote_identifiers(&sql),
        _ => sql.clone(), // PostgreSQL and others don't use backticks
    };

    let query_id = query_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    events::emit_query_started(
        &app,
        events::QueryStartedPayload {
            query_id: query_id.clone(),
            connection_id: connection_id.clone(),
            sql: quoted_sql.clone(),
        },
    );

    let query_service = state.query_service.clone();
    let app_handle = app.clone();
    let task_query_id = query_id.clone();
    tauri::async_runtime::spawn(async move {
        let result = query_service
            .execute_with_id(task_query_id.clone(), &connection_id, &quoted_sql)
            .await;

        match result {
            Ok(result) => match result.status {
                QueryStatus::Ready => {
                    events::emit_query_ready(
                        &app_handle,
                        events::QueryReadyPayload {
                            query_id: result.query_id,
                            columns: result.columns,
                            row_count: result.row_count,
                            execution_time_ms: result.execution_time_ms.unwrap_or(0),
                            affected_rows: result.affected_rows,
                        },
                    );
                }
                QueryStatus::Cancelled => {
                    events::emit_query_cancelled(
                        &app_handle,
                        events::QueryCancelledPayload {
                            query_id: result.query_id,
                        },
                    );
                }
                QueryStatus::Error => {
                    events::emit_query_error(
                        &app_handle,
                        events::QueryErrorPayload {
                            query_id: result.query_id,
                            error: result.error.unwrap_or_default(),
                        },
                    );
                }
                QueryStatus::Running => {}
            },
            Err(error) => {
                if query_service.is_cancelled(&task_query_id).await {
                    events::emit_query_cancelled(
                        &app_handle,
                        events::QueryCancelledPayload {
                            query_id: task_query_id,
                        },
                    );
                } else {
                    events::emit_query_error(
                        &app_handle,
                        events::QueryErrorPayload {
                            query_id: task_query_id,
                            error: error.to_string(),
                        },
                    );
                }
            }
        }
    });

    Ok(QueryResultMeta {
        query_id,
        columns: vec![],
        status: QueryStatus::Running,
        row_count: None,
        execution_time_ms: None,
        error: None,
        affected_rows: None,
    })
}

#[tauri::command]
pub async fn fetch_cells(
    state: State<'_, AppState>,
    query_id: String,
    row_start: usize,
    row_end: usize,
    col_start: usize,
    col_end: usize,
) -> Result<CellBlock, String> {
    state
        .query_service
        .fetch_cells(&query_id, row_start, row_end, col_start, col_end)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_query(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    query_id: String,
) -> Result<(), String> {
    state
        .query_service
        .cancel(&query_id)
        .await
        .map_err(|e| e.to_string())?;
    events::emit_query_cancelled(&app, events::QueryCancelledPayload { query_id });
    Ok(())
}
