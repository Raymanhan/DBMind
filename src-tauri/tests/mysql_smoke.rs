use std::collections::HashMap;
use std::sync::Arc;

use dbmind_core::traits::{ConnectionManager, QueryExecutor};
use dbmind_core::types::{ConnectionConfig, DatabaseDriver};
use dbmind_db::manager::ConnectionManagerImpl;
use dbmind_query::executor::QueryExecutorImpl;
use dbmind_schema::index::SchemaIndex;
use dbmind_schema::refresh::SchemaRefresh;

fn mysql_config_from_env() -> Option<ConnectionConfig> {
    let enabled = std::env::var("DBMIND_MYSQL_SMOKE").ok()?;
    if enabled != "1" {
        return None;
    }

    Some(ConnectionConfig {
        id: "mysql-smoke".to_string(),
        name: "MySQL Smoke".to_string(),
        driver: DatabaseDriver::Mysql,
        host: std::env::var("DBMIND_MYSQL_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
        port: std::env::var("DBMIND_MYSQL_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(3306),
        username: std::env::var("DBMIND_MYSQL_USER").unwrap_or_else(|_| "root".to_string()),
        password: std::env::var("DBMIND_MYSQL_PASSWORD").ok(),
        database: Some(
            std::env::var("DBMIND_MYSQL_DATABASE").unwrap_or_else(|_| "test".to_string()),
        ),
        ssl: false,
        ssh_host: None,
        ssh_port: None,
        ssh_user: None,
        ssh_key: None,
        extra_params: HashMap::new(),
    })
}

#[tokio::test]
async fn mysql_connection_query_and_schema_smoke() {
    let Some(config) = mysql_config_from_env() else {
        eprintln!("Skipping MySQL smoke test; set DBMIND_MYSQL_SMOKE=1 to enable.");
        return;
    };

    let database = config.database.clone().expect("smoke config has database");
    let manager = Arc::new(ConnectionManagerImpl::new());
    let connection_id = manager.connect(&config).await.expect("connects to MySQL");

    let result_store = Arc::new(dbmind_cache::store::ResultStore::new());
    let executor = Arc::new(QueryExecutorImpl::new(
        manager.clone(),
        result_store.clone(),
    ));
    let result = executor
        .execute_query_with_id(
            "mysql-smoke-query".to_string(),
            &connection_id,
            "SELECT 1 AS one",
        )
        .await
        .expect("executes SELECT");

    assert_eq!(result.columns.len(), 1);
    assert_eq!(result.row_count, Some(1));

    let block = result_store
        .fetch_block("mysql-smoke-query", 0, 1, 0, 1)
        .await
        .expect("fetches stored result block");
    assert_eq!(block.rows.len(), 1);
    assert_eq!(block.rows[0].len(), 1);

    let schema_index = Arc::new(SchemaIndex::new());
    let refresher = SchemaRefresh::new(schema_index.clone(), manager.clone());
    refresher
        .full_refresh(&connection_id, &database)
        .await
        .expect("refreshes schema");

    let tables = schema_index.get_database_tables(&database).await;
    assert!(
        !tables.is_empty(),
        "expected at least one table in database {database}"
    );

    let cancellable_executor = executor.clone();
    let cancellable_connection_id = connection_id.clone();
    let cancel_start = std::time::Instant::now();
    let cancellable = tokio::spawn(async move {
        cancellable_executor
            .execute_query_with_id(
                "mysql-smoke-cancel".to_string(),
                &cancellable_connection_id,
                "SELECT SLEEP(5) AS slept",
            )
            .await
    });

    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    executor
        .cancel_query("mysql-smoke-cancel")
        .await
        .expect("kills database query and marks query as cancelled");

    let cancelled = cancellable
        .await
        .expect("query task joins")
        .expect("query returns cancelled metadata");
    assert!(
        cancel_start.elapsed() < std::time::Duration::from_secs(3),
        "database-side cancellation should return before the full sleep finishes"
    );
    assert_eq!(cancelled.status, dbmind_core::types::QueryStatus::Cancelled);
    assert!(
        result_store
            .fetch_block("mysql-smoke-cancel", 0, 1, 0, 1)
            .await
            .is_none(),
        "cancelled query should not leave stored results"
    );

    manager
        .disconnect(&connection_id)
        .await
        .expect("disconnects cleanly");
}
