use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Database type
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseDriver {
    Mysql,
    Postgres,
    Sqlite,
}

/// Connection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub driver: DatabaseDriver,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub database: Option<String>,
    pub ssl: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_key: Option<String>,
    pub extra_params: HashMap<String, String>,
}

/// Column metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
    pub max_length: Option<u64>,
    pub decimal_digits: Option<u32>,
}

/// A single cell value
#[derive(Debug, Clone, PartialEq)]
pub enum CellValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    String(String),
    Blob(Vec<u8>),
}

impl Serialize for CellValue {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            CellValue::Null => serializer.serialize_none(),
            CellValue::Bool(b) => serializer.serialize_bool(*b),
            CellValue::Int(n) => serializer.serialize_i64(*n),
            CellValue::Float(f) => serializer.serialize_f64(*f),
            CellValue::String(s) => serializer.serialize_str(s),
            // Encode blobs as base64 strings with a distinguishing prefix
            CellValue::Blob(bytes) => {
                let encoded = format!("__blob__:{}", base64_encoding(bytes));
                serializer.serialize_str(&encoded)
            }
        }
    }
}

impl<'de> Deserialize<'de> for CellValue {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        use serde::de::{self, Visitor};

        struct CellValueVisitor;

        impl<'de> Visitor<'de> for CellValueVisitor {
            type Value = CellValue;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("a cell value (null, bool, number, or string)")
            }

            fn visit_none<E: de::Error>(self) -> Result<CellValue, E> {
                Ok(CellValue::Null)
            }

            fn visit_unit<E: de::Error>(self) -> Result<CellValue, E> {
                Ok(CellValue::Null)
            }

            fn visit_bool<E: de::Error>(self, v: bool) -> Result<CellValue, E> {
                Ok(CellValue::Bool(v))
            }

            fn visit_i64<E: de::Error>(self, v: i64) -> Result<CellValue, E> {
                Ok(CellValue::Int(v))
            }

            fn visit_u64<E: de::Error>(self, v: u64) -> Result<CellValue, E> {
                if v <= i64::MAX as u64 {
                    Ok(CellValue::Int(v as i64))
                } else {
                    Ok(CellValue::Float(v as f64))
                }
            }

            fn visit_f64<E: de::Error>(self, v: f64) -> Result<CellValue, E> {
                Ok(CellValue::Float(v))
            }

            fn visit_str<E: de::Error>(self, v: &str) -> Result<CellValue, E> {
                Ok(CellValue::String(v.to_string()))
            }

            fn visit_string<E: de::Error>(self, v: String) -> Result<CellValue, E> {
                Ok(CellValue::String(v))
            }
        }

        deserializer.deserialize_any(CellValueVisitor)
    }
}

fn base64_encoding(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        result.push(if chunk.len() > 1 { CHARS[((triple >> 6) & 0x3F) as usize] as char } else { '=' });
        result.push(if chunk.len() > 2 { CHARS[(triple & 0x3F) as usize] as char } else { '=' });
    }
    result
}

/// A block of cells for grid rendering
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellBlock {
    pub row_start: usize,
    pub col_start: usize,
    pub rows: Vec<Vec<CellValue>>,
    pub total_rows: Option<usize>,
}

/// Table schema information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableSchema {
    pub database: String,
    pub schema: Option<String>,
    pub table: String,
    pub table_type: String,
    pub columns: Vec<ColumnMeta>,
    pub indexes: Vec<IndexMeta>,
    pub foreign_keys: Vec<ForeignKeyMeta>,
    pub row_count: Option<u64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexMeta {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
    pub primary: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyMeta {
    pub name: String,
    pub column: String,
    pub ref_table: String,
    pub ref_column: String,
}

/// Query execution status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum QueryStatus {
    Running,
    Ready,
    Error,
    Cancelled,
}

/// Result of execute_query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResultMeta {
    pub query_id: String,
    pub columns: Vec<ColumnMeta>,
    pub status: QueryStatus,
    pub row_count: Option<usize>,
    pub execution_time_ms: Option<u64>,
    pub error: Option<String>,
    pub affected_rows: Option<u64>,
}

/// Schema summary for AI context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaSummary {
    pub tables: Vec<TableBrief>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableBrief {
    pub name: String,
    pub columns: Vec<ColumnBrief>,
    pub row_count: Option<u64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnBrief {
    pub name: String,
    pub data_type: String,
    pub comment: Option<String>,
}

/// AI provider configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: AiProvider,
    pub api_key: Option<String>,
    pub api_url: Option<String>,
    pub model: String,
    pub max_tokens: u32,
    pub temperature: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    Openai,
    Ollama,
    Compatible,
}

/// App settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    pub locale: String,
    pub font_size: u32,
    pub tab_size: u32,
    pub ai: Option<AiConfig>,
}

/// Cross-database table brief for @ mention search
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrossDbTableBrief {
    pub database: String,
    pub name: String,
    pub columns: Vec<ColumnBrief>,
    pub row_count: Option<u64>,
    pub comment: Option<String>,
}
