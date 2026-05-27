import { invoke } from '@tauri-apps/api/core';

import type {
  ConnectionConfig,
  QueryResultMeta,
  CellBlock,
  TableSchema,
  TableBrief,
  CrossDbTableBrief,
} from './types';

// ─── Connections ────────────────────────────────────────────────
export async function connect(config: ConnectionConfig): Promise<string> {
  return invoke('connect', { config });
}

export async function disconnect(connectionId: string): Promise<void> {
  return invoke('disconnect', { connection_id: connectionId });
}

export async function testConnection(config: ConnectionConfig): Promise<boolean> {
  return invoke('test_connection', { config });
}

export async function listConnections(): Promise<ConnectionConfig[]> {
  return invoke('list_connections');
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke('delete_connection', { id });
}

export async function listDatabases(connectionId: string): Promise<string[]> {
  return invoke('list_databases', { connection_id: connectionId });
}

// ─── Query ──────────────────────────────────────────────────────
export async function executeQuery(
  connectionId: string,
  sql: string,
  queryId?: string,
): Promise<QueryResultMeta> {
  return invoke('execute_query', { connection_id: connectionId, sql, query_id: queryId ?? null });
}

export async function fetchCells(
  queryId: string,
  rowStart: number,
  rowEnd: number,
  colStart: number,
  colEnd: number,
): Promise<CellBlock> {
  return invoke('fetch_cells', { query_id: queryId, row_start: rowStart, row_end: rowEnd, col_start: colStart, col_end: colEnd });
}

export async function cancelQuery(queryId: string): Promise<void> {
  return invoke('cancel_query', { query_id: queryId });
}

// ─── Schema ─────────────────────────────────────────────────────
export async function getSchema(
  database: string,
  table?: string,
): Promise<TableSchema[]> {
  return invoke('get_schema', { database, table: table ?? null });
}

export async function searchTables(
  database: string,
  query: string,
): Promise<TableBrief[]> {
  return invoke('search_tables', { database, query });
}

export async function searchAllTables(
  query: string,
): Promise<CrossDbTableBrief[]> {
  return invoke('search_all_tables', { query });
}

export async function refreshSchema(
  connectionId: string,
  database: string,
): Promise<void> {
  return invoke('refresh_schema', { connection_id: connectionId, database });
}

export async function generateDdl(
  database: string,
  table: string,
): Promise<string> {
  return invoke('generate_ddl', { database, table });
}

// ─── AI ─────────────────────────────────────────────────────────
export async function aiChat(
  database: string,
  messages: Array<{ role: string; content: string }>,
  currentSql?: string,
  pinnedDdl?: string[],
  apiKey?: string,
  model?: string,
  apiUrl?: string,
  maxTokens?: number,
  temperature?: number,
): Promise<string> {
  return invoke('chat', {
    database,
    messages,
    current_sql: currentSql ?? null,
    pinned_ddl: pinnedDdl ?? null,
    api_key: apiKey ?? null,
    model: model ?? null,
    api_url: apiUrl ?? null,
    max_tokens: maxTokens ?? null,
    temperature: temperature ?? null,
  });
}

export async function nl2sql(
  database: string,
  question: string,
  apiKey?: string,
  model?: string,
  apiUrl?: string,
  maxTokens?: number,
  temperature?: number,
): Promise<string> {
  return invoke('nl2sql', {
    database,
    question,
    api_key: apiKey ?? null,
    model: model ?? null,
    api_url: apiUrl ?? null,
    max_tokens: maxTokens ?? null,
    temperature: temperature ?? null,
  });
}

export async function explainSql(
  sql: string,
  apiKey?: string,
  model?: string,
  apiUrl?: string,
  maxTokens?: number,
  temperature?: number,
): Promise<string> {
  return invoke('explain_sql', {
    sql,
    api_key: apiKey ?? null,
    model: model ?? null,
    api_url: apiUrl ?? null,
    max_tokens: maxTokens ?? null,
    temperature: temperature ?? null,
  });
}

// ─── SQL ────────────────────────────────────────────────────────
export async function formatSql(sql: string): Promise<string> {
  return invoke('format_sql', { sql });
}

export async function splitSql(sql: string): Promise<string[]> {
  return invoke('split_sql', { sql });
}

export async function currentStatement(sql: string, offset: number): Promise<string | null> {
  return invoke('current_statement', { sql, offset });
}

export async function validateSql(sql: string): Promise<string[]> {
  return invoke('validate_sql', { sql });
}

export async function extractTables(sql: string): Promise<string[]> {
  return invoke('extract_tables', { sql });
}
