use dbmind_core::errors::CacheError;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::ZERO)
        .as_secs() as i64
}

/// SQLite-based cache backend for query results and schema
pub struct CacheBackend {
    conn: Mutex<Connection>,
}

impl CacheBackend {
    pub fn new(path: &Path) -> Result<Self, CacheError> {
        let conn = Connection::open(path).map_err(|e| CacheError::BackendError(e.to_string()))?;

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS cache_store (
                key TEXT PRIMARY KEY,
                value BLOB NOT NULL,
                expires_at INTEGER,
                created_at INTEGER DEFAULT (unixepoch())
            );
            CREATE TABLE IF NOT EXISTS query_results (
                query_id TEXT PRIMARY KEY,
                columns TEXT NOT NULL,
                row_count INTEGER DEFAULT 0,
                storage TEXT NOT NULL DEFAULT 'memory',
                created_at INTEGER DEFAULT (unixepoch())
            );
            CREATE TABLE IF NOT EXISTS result_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                query_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                data BLOB NOT NULL,
                FOREIGN KEY (query_id) REFERENCES query_results(query_id)
            );
            CREATE INDEX IF NOT EXISTS idx_result_chunks_query
                ON result_chunks(query_id, chunk_index);
            ",
        )
        .map_err(|e| CacheError::BackendError(e.to_string()))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Store a value in cache
    pub fn set(&self, key: &str, value: &[u8], ttl_secs: Option<u64>) -> Result<(), CacheError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| CacheError::BackendError(e.to_string()))?;
        let expires = ttl_secs.map(|s| now_secs() + s as i64);

        conn.execute(
            "INSERT OR REPLACE INTO cache_store (key, value, expires_at) VALUES (?1, ?2, ?3)",
            rusqlite::params![key, value, expires],
        )
        .map_err(|e| CacheError::BackendError(e.to_string()))?;

        Ok(())
    }

    /// Get a value from cache
    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>, CacheError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| CacheError::BackendError(e.to_string()))?;

        let mut stmt = conn
            .prepare("SELECT value, expires_at FROM cache_store WHERE key = ?1")
            .map_err(|e| CacheError::BackendError(e.to_string()))?;

        let result = stmt
            .query_row(rusqlite::params![key], |row| {
                let value: Vec<u8> = row.get(0)?;
                let expires: Option<i64> = row.get(1)?;
                Ok((value, expires))
            })
            .ok();

        match result {
            Some((value, Some(expires))) => {
                if now_secs() > expires {
                    Ok(None)
                } else {
                    Ok(Some(value))
                }
            }
            Some((value, None)) => Ok(Some(value)),
            None => Ok(None),
        }
    }

    /// Delete a key
    pub fn delete(&self, key: &str) -> Result<(), CacheError> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| CacheError::BackendError(e.to_string()))?;
        conn.execute(
            "DELETE FROM cache_store WHERE key = ?1",
            rusqlite::params![key],
        )
        .map_err(|e| CacheError::BackendError(e.to_string()))?;
        Ok(())
    }
}
