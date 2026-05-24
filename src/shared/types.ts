export type DatabaseDriver = 'mysql' | 'postgres';

export interface DbConnectionConfig {
  id: string;
  name: string;
  driver: DatabaseDriver;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  charset?: string;
  timezone?: string;
  connectTimeout?: number;
  readonly?: boolean;
}

export interface ColumnSchema {
  name: string;
  type: string;
  nullable?: boolean;
  primary?: boolean;
  references?: string;
  defaultValue?: string | null;
  comment?: string;
  extra?: string;
  indexed?: boolean;
}

export interface TableSchema {
  name: string;
  schema?: string;
  type?: 'table' | 'view';
  rowCount?: number;
  comment?: string;
  engine?: string;
  collation?: string;
  columns: ColumnSchema[];
}

export interface DatabaseInfo {
  name: string;
  system?: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  durationMs: number;
  rowCount: number;
}

export interface QueryHistoryItem {
  id: string;
  connectionId: string;
  connectionName: string;
  database?: string;
  sql: string;
  rowCount: number;
  durationMs: number;
  createdAt: string;
}

export interface AiGenerateRequest {
  prompt: string;
  dialect: DatabaseDriver;
  tables: TableSchema[];
}

export interface AiGenerateResponse {
  sql: string;
  explanation: string;
  usedTables: string[];
  source: 'openai' | 'openai-compatible' | 'local';
  warnings: string[];
}

export type AiProviderType = 'openai' | 'openai-compatible' | 'azure-openai' | 'ollama' | 'custom';
export type AiApiMode = 'responses' | 'chat-completions';

export interface AiProviderConfig {
  id: string;
  name: string;
  provider: AiProviderType;
  apiMode: AiApiMode;
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  streaming?: boolean;
  defaultDialect?: DatabaseDriver;
  allowWriteSql?: boolean;
  appendLimit?: boolean;
}

export interface AppSettings {
  aiProviders: AiProviderConfig[];
  defaultAiProviderId?: string;
}

export interface DbmindApi {
  getConnections(): Promise<DbConnectionConfig[]>;
  saveConnection(config: DbConnectionConfig): Promise<DbConnectionConfig[]>;
  deleteConnection(id: string): Promise<DbConnectionConfig[]>;
  testConnection(config: DbConnectionConfig): Promise<{ ok: boolean; message: string }>;
  listDatabases(config: DbConnectionConfig): Promise<DatabaseInfo[]>;
  getSchema(connectionId: string): Promise<TableSchema[]>;
  getTableDdl(connectionId: string, tableName: string): Promise<string>;
  runQuery(connectionId: string, sql: string): Promise<QueryResult>;
  getQueryHistory(): Promise<QueryHistoryItem[]>;
  clearQueryHistory(): Promise<QueryHistoryItem[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  testAiProvider(config: AiProviderConfig): Promise<{ ok: boolean; message: string }>;
  generateSql(input: AiGenerateRequest): Promise<AiGenerateResponse>;
}
