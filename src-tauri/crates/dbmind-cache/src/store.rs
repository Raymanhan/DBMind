use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::RwLock;

use crate::backend::CacheBackend;
use dbmind_core::types::*;

const MEMORY_THRESHOLD: usize = 10_000;
const CHUNK_SIZE: usize = 1_000;

/// Tiered result store:
///   Small (< 10k rows): in-memory HashMap
///   Large (>= 10k rows): SQLite-backed via CacheBackend
pub struct ResultStore {
    memory_store: RwLock<HashMap<String, StoredResult>>,
    backend: RwLock<Option<CacheBackend>>,
    backend_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct StoredResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Vec<CellValue>>,
    pub row_count: usize,
    pub storage_tier: StorageTier,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StorageTier {
    Memory,
    Sqlite,
}

impl ResultStore {
    pub fn new() -> Self {
        let path = std::env::temp_dir().join("dbmind_results.db");
        Self {
            memory_store: RwLock::new(HashMap::new()),
            backend: RwLock::new(None),
            backend_path: path,
        }
    }

    async fn ensure_backend(&self) -> Result<(), String> {
        let mut backend = self.backend.write().await;
        if backend.is_none() {
            let b = CacheBackend::new(&self.backend_path)
                .map_err(|e| format!("Failed to open cache: {}", e))?;
            *backend = Some(b);
        }
        Ok(())
    }

    /// Store a query result, choosing tier based on row count
    pub async fn store(&self, query_id: &str, columns: Vec<ColumnMeta>, rows: Vec<Vec<CellValue>>) {
        let row_count = rows.len();
        let tier = if row_count >= MEMORY_THRESHOLD {
            StorageTier::Sqlite
        } else {
            StorageTier::Memory
        };

        match tier {
            StorageTier::Memory => {
                let result = StoredResult {
                    columns,
                    rows,
                    row_count,
                    storage_tier: StorageTier::Memory,
                };
                self.memory_store
                    .write()
                    .await
                    .insert(query_id.to_string(), result);
            }
            StorageTier::Sqlite => {
                let columns_json =
                    serde_json::to_string(&columns).unwrap_or_else(|_| "[]".to_string());

                // Store query metadata
                if let Ok(_) = self.ensure_backend().await {
                    let backend = self.backend.read().await;
                    if let Some(ref b) = *backend {
                        let _ = b.set(
                            &format!("query:{}:meta", query_id),
                            columns_json.as_bytes(),
                            Some(3600),
                        );
                        let _ = b.set(
                            &format!("query:{}:count", query_id),
                            &row_count.to_le_bytes(),
                            Some(3600),
                        );

                        // Store rows in chunks
                        for (chunk_idx, chunk) in rows.chunks(CHUNK_SIZE).enumerate() {
                            let chunk_json =
                                serde_json::to_string(chunk).unwrap_or_else(|_| "[]".to_string());
                            let _ = b.set(
                                &format!("query:{}:chunk:{}", query_id, chunk_idx),
                                chunk_json.as_bytes(),
                                Some(3600),
                            );
                        }
                    }
                }

                // Also keep a lightweight index in memory
                let placeholder = StoredResult {
                    columns: vec![],
                    rows: vec![],
                    row_count,
                    storage_tier: StorageTier::Sqlite,
                };
                self.memory_store
                    .write()
                    .await
                    .insert(query_id.to_string(), placeholder);
            }
        }
    }

    /// Fetch a block of cells, reading from memory or SQLite as needed
    pub async fn fetch_block(
        &self,
        query_id: &str,
        row_start: usize,
        row_end: usize,
        col_start: usize,
        col_end: usize,
    ) -> Option<CellBlock> {
        let store = self.memory_store.read().await;
        let result = store.get(query_id)?;

        let row_start = row_start.min(result.row_count);
        let row_end = row_end.min(result.row_count).max(row_start);
        let total_rows = Some(result.row_count);

        match result.storage_tier {
            StorageTier::Memory => {
                let rows: Vec<Vec<CellValue>> = result.rows[row_start..row_end]
                    .iter()
                    .map(|row| {
                        let col_start = col_start.min(row.len());
                        let col_end = col_end.min(row.len());
                        let col_end = col_end.max(col_start);
                        row[col_start..col_end].to_vec()
                    })
                    .collect();
                Some(CellBlock {
                    row_start,
                    col_start,
                    rows,
                    total_rows,
                })
            }
            StorageTier::Sqlite => {
                drop(store);
                self.fetch_block_from_sqlite(
                    query_id, row_start, row_end, col_start, col_end, total_rows,
                )
                .await
            }
        }
    }

    async fn fetch_block_from_sqlite(
        &self,
        query_id: &str,
        row_start: usize,
        row_end: usize,
        col_start: usize,
        col_end: usize,
        total_rows: Option<usize>,
    ) -> Option<CellBlock> {
        let backend = self.backend.read().await;
        let b = backend.as_ref()?;

        let chunk_start = row_start / CHUNK_SIZE;
        let chunk_end = (row_end.saturating_sub(1)) / CHUNK_SIZE + 1;

        let mut all_rows: Vec<Vec<CellValue>> = Vec::with_capacity(row_end - row_start);

        for chunk_idx in chunk_start..chunk_end {
            let key = format!("query:{}:chunk:{}", query_id, chunk_idx);
            if let Ok(Some(data)) = b.get(&key) {
                if let Ok(chunk) = serde_json::from_slice::<Vec<Vec<CellValue>>>(&data) {
                    let chunk_offset = chunk_idx * CHUNK_SIZE;
                    for (i, row) in chunk.iter().enumerate() {
                        let global_row = chunk_offset + i;
                        if global_row >= row_start && global_row < row_end {
                            let col_start = col_start.min(row.len());
                            let col_end = col_end.min(row.len());
                            let col_end = col_end.max(col_start);
                            all_rows.push(row[col_start..col_end].to_vec());
                        }
                    }
                }
            }
        }

        Some(CellBlock {
            row_start,
            col_start,
            rows: all_rows,
            total_rows,
        })
    }

    /// Get total row count for a query
    pub async fn row_count(&self, query_id: &str) -> Option<usize> {
        let store = self.memory_store.read().await;
        store.get(query_id).map(|r| r.row_count)
    }

    /// Remove a stored result
    pub async fn remove(&self, query_id: &str) {
        let row_count = {
            let store = self.memory_store.read().await;
            store.get(query_id).map(|r| r.row_count)
        };
        self.memory_store.write().await.remove(query_id);

        let backend = self.backend.read().await;
        if let Some(ref b) = *backend {
            let _ = b.delete(&format!("query:{}:meta", query_id));
            let _ = b.delete(&format!("query:{}:count", query_id));

            // Remove all chunks: calculate chunk count from row_count
            if let Some(count) = row_count {
                let num_chunks = (count + CHUNK_SIZE - 1) / CHUNK_SIZE;
                for chunk_idx in 0..num_chunks {
                    let _ = b.delete(&format!("query:{}:chunk:{}", query_id, chunk_idx));
                }
            } else {
                // Fallback: try deleting chunks until we don't find one
                for chunk_idx in 0.. {
                    let key = format!("query:{}:chunk:{}", query_id, chunk_idx);
                    match b.get(&key) {
                        Ok(Some(_)) => { let _ = b.delete(&key); }
                        _ => break,
                    }
                }
            }
        }
    }
}
