use std::collections::HashMap;
use tokio::sync::RwLock;

use crate::connection::{Driver, QueryResult};
use crate::mysql::MysqlDriver;
use crate::postgres::PostgresDriver;
use dbmind_core::errors::DbError;
use dbmind_core::traits::ConnectionManager;
use dbmind_core::types::{ConnectionConfig, DatabaseDriver};

/// Manages all database connections
pub struct ConnectionManagerImpl {
    connections: RwLock<HashMap<String, Box<dyn Driver>>>,
    configs: RwLock<HashMap<String, ConnectionConfig>>,
}

impl ConnectionManagerImpl {
    pub fn new() -> Self {
        Self {
            connections: RwLock::new(HashMap::new()),
            configs: RwLock::new(HashMap::new()),
        }
    }

    fn create_driver(driver: &DatabaseDriver) -> Result<Box<dyn Driver>, DbError> {
        match driver {
            DatabaseDriver::Mysql => Ok(Box::new(MysqlDriver::new())),
            DatabaseDriver::Postgres => Ok(Box::new(PostgresDriver::new())),
            DatabaseDriver::Sqlite => Err(DbError::DriverError("SQLite not yet supported".into())),
        }
    }

    /// Get the driver type for a connection
    pub async fn driver_type(&self, connection_id: &str) -> Option<DatabaseDriver> {
        let conns = self.connections.read().await;
        conns.get(connection_id).map(|d| d.driver_type())
    }

    /// Get the stored config for a connection
    pub async fn get_config(&self, connection_id: &str) -> Option<ConnectionConfig> {
        let configs = self.configs.read().await;
        configs.get(connection_id).cloned()
    }

    /// Execute SQL on a specific connection — used by the QueryExecutor
    pub async fn exec_sql(&self, connection_id: &str, sql: &str) -> Result<QueryResult, DbError> {
        let conns = self.connections.read().await;
        let driver = conns.get(connection_id).ok_or(DbError::NotConnected)?;
        driver.exec(sql).await
    }

    pub async fn exec_sql_with_query_id(
        &self,
        connection_id: &str,
        query_id: &str,
        sql: &str,
    ) -> Result<QueryResult, DbError> {
        let conns = self.connections.read().await;
        let driver = conns.get(connection_id).ok_or(DbError::NotConnected)?;
        driver.exec_with_query_id(query_id, sql).await
    }

    pub async fn cancel_query(&self, connection_id: &str, query_id: &str) -> Result<(), DbError> {
        let conns = self.connections.read().await;
        let driver = conns.get(connection_id).ok_or(DbError::NotConnected)?;
        driver.cancel_query(query_id).await
    }
}

#[async_trait::async_trait]
impl ConnectionManager for ConnectionManagerImpl {
    async fn connect(&self, config: &ConnectionConfig) -> Result<String, DbError> {
        let driver = Self::create_driver(&config.driver)?;
        driver.connect(config).await?;

        let id = config.id.clone();
        self.configs.write().await.insert(id.clone(), config.clone());
        let mut conns = self.connections.write().await;
        conns.insert(id.clone(), driver);

        Ok(id)
    }

    async fn disconnect(&self, connection_id: &str) -> Result<(), DbError> {
        self.configs.write().await.remove(connection_id);
        let mut conns = self.connections.write().await;
        if let Some(driver) = conns.remove(connection_id) {
            driver.disconnect().await?;
        }
        Ok(())
    }

    async fn test_connection(&self, config: &ConnectionConfig) -> Result<bool, DbError> {
        let driver = Self::create_driver(&config.driver)?;
        driver.connect(config).await.map(|_| true)
    }

    fn active_connections(&self) -> Vec<String> {
        self.connections.blocking_read().keys().cloned().collect()
    }
}
