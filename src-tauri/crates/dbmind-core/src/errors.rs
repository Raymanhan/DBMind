use thiserror::Error;

#[derive(Error, Debug)]
pub enum DbError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Query failed: {0}")]
    QueryFailed(String),

    #[error("Not connected to any database")]
    NotConnected,

    #[error("Invalid query: {0}")]
    InvalidQuery(String),

    #[error("Driver error: {0}")]
    DriverError(String),

    #[error("Transaction error: {0}")]
    TransactionError(String),

    #[error("Timeout")]
    Timeout,
}

#[derive(Error, Debug)]
pub enum SchemaError {
    #[error("Failed to read schema: {0}")]
    ReadFailed(String),

    #[error("Table not found: {0}")]
    TableNotFound(String),

    #[error("Cache error: {0}")]
    CacheError(String),
}

#[derive(Error, Debug)]
pub enum AiError {
    #[error("AI provider error: {0}")]
    ProviderError(String),

    #[error("API error: {0}")]
    ApiError(String),

    #[error("Context too large")]
    ContextTooLarge,
}

#[derive(Error, Debug)]
pub enum CacheError {
    #[error("Backend error: {0}")]
    BackendError(String),

    #[error("Key not found: {0}")]
    KeyNotFound(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),
}
