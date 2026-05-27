use crate::AppState;
use dbmind_core::traits::ConnectionManager;
use dbmind_core::types::*;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
struct ConnectionsFile {
    connections: Vec<ConnectionConfig>,
}

fn connections_path() -> std::path::PathBuf {
    let dir = dirs::data_dir().unwrap_or_else(|| {
        let mut d = std::env::temp_dir();
        d.push("dbmind");
        d
    });
    let dbmind_dir = dir.join("DBMind");
    std::fs::create_dir_all(&dbmind_dir).ok();
    dbmind_dir.join("connections.json")
}

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<String, String> {
    let id = state
        .conn_manager
        .connect(&config)
        .await
        .map_err(|e| e.to_string())?;

    // Persist to JSON
    save_config(&config).map_err(|e| e.to_string())?;

    Ok(id)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>, connection_id: String) -> Result<(), String> {
    state
        .conn_manager
        .disconnect(&connection_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
) -> Result<bool, String> {
    state
        .conn_manager
        .test_connection(&config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_connections() -> Result<Vec<ConnectionConfig>, String> {
    load_configs().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_connection(id: String) -> Result<(), String> {
    let mut configs = load_configs().map_err(|e| e.to_string())?;
    configs.retain(|c| c.id != id);
    save_configs(&configs).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let driver_type = state
        .conn_manager
        .driver_type(&connection_id)
        .await
        .ok_or_else(|| "Connection not found".to_string())?;

    let sql = match driver_type {
        DatabaseDriver::Mysql => "SHOW DATABASES",
        DatabaseDriver::Postgres => {
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
        }
        DatabaseDriver::Sqlite => return Ok(vec!["main".to_string()]),
    };

    let result = state
        .conn_manager
        .exec_sql(&connection_id, sql)
        .await
        .map_err(|e| e.to_string())?;

    let databases: Vec<String> = result
        .rows
        .iter()
        .map(|row| match row.first() {
            Some(dbmind_core::types::CellValue::String(s)) => s.clone(),
            Some(_) => String::new(),
            None => String::new(),
        })
        .filter(|s| !s.is_empty())
        .collect();

    Ok(databases)
}

fn save_config(config: &ConnectionConfig) -> Result<(), std::io::Error> {
    let mut configs = load_configs().unwrap_or_default();
    if let Some(pos) = configs.iter().position(|c| c.id == config.id) {
        configs[pos] = config.clone();
    } else {
        configs.push(config.clone());
    }
    save_configs(&configs)
}

fn save_configs(configs: &[ConnectionConfig]) -> Result<(), std::io::Error> {
    let file = ConnectionsFile {
        connections: configs.to_vec(),
    };
    let json = serde_json::to_string_pretty(&file)?;
    std::fs::write(connections_path(), json)
}

fn load_configs() -> Result<Vec<ConnectionConfig>, std::io::Error> {
    let path = connections_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let json = std::fs::read_to_string(&path)?;
    let file: ConnectionsFile = serde_json::from_str(&json)?;
    Ok(file.connections)
}
