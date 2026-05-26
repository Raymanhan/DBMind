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
  dbName?: string;
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

export type ResultTab = 'results' | 'history';

export interface WorkTab {
  id: string;
  title: string;
  kind: 'sql' | 'table';
  dbName?: string;
  tableName?: string;
  baseSql: string;
  sql: string;
  result: QueryResult | null;
  resultTab: ResultTab;
  sort?: { column: string; direction: 'asc' | 'desc' };
}

export interface EditableCellContext {
  connectionId: string;
  database: string;
  table: string;
  column: string;
  primaryKey: Record<string, unknown>;
  value: unknown;
}

export interface UpdateCellRequest extends EditableCellContext {
  execute?: boolean;
}

export interface UpdateCellResponse {
  sql: string;
  ok: boolean;
  affectedRows?: number;
  message?: string;
}

export interface BatchCellEditEntry {
  column: string;
  primaryKey: Record<string, unknown>;
  value: unknown;
}

export interface BatchUpdateCellRequest {
  connectionId: string;
  database: string;
  table: string;
  edits: BatchCellEditEntry[];
  execute?: boolean;
}

export interface BatchUpdateCellResponse {
  sqls: string[];
  ok: boolean;
  affectedRows?: number;
}

export interface QueryHistoryItem {
  id: string;
  connectionId: string;
  connectionName: string;
  database?: string;
  sql: string;
  source?: 'query' | 'data-edit' | 'schema-edit';
  rowCount: number;
  durationMs: number;
  createdAt: string;
}

export interface AiHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiTableDdl {
  database?: string;
  table: string;
  ddl: string;
}

export interface AiGenerateRequest {
  prompt: string;
  dialect: DatabaseDriver;
  tables: TableSchema[];
  tableDdls?: AiTableDdl[];
  history?: AiHistoryMessage[];
}

export interface AiOptimizeRequest {
  sql: string;
  dialect: DatabaseDriver;
  tables: TableSchema[];
}

export interface AiOptimizeResponse {
  sql: string;
  explanation: string;
  source: 'openai' | 'openai-compatible' | 'local';
  warnings: string[];
}

export interface AiGenerateResponse {
  sql: string;
  explanation: string;
  usedTables: string[];
  source: 'openai' | 'openai-compatible' | 'local';
  warnings: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  meta?: string;
  warnings?: string[];
}

export interface AiConversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export type AiProviderType = 'openai' | 'openai-compatible' | 'azure-openai' | 'ollama' | 'custom';
export type AiApiMode = 'responses' | 'chat-completions';
export type AppTheme = 'dark' | 'light';

export interface TableDesignColumn {
  name: string;
  originalName?: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  autoIncrement?: boolean;
  defaultValue?: string | null;
  comment?: string;
  dropped?: boolean;
}

export interface TableDesignIndex {
  name: string;
  originalName?: string;
  unique?: boolean;
  columns: string[];
  dropped?: boolean;
}

export interface TableDesignForeignKey {
  name: string;
  originalName?: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onUpdate?: string;
  onDelete?: string;
  dropped?: boolean;
}

export interface TableDesign {
  database: string;
  table: string;
  engine?: string;
  collation?: string;
  comment?: string;
  columns: TableDesignColumn[];
  indexes: TableDesignIndex[];
  foreignKeys: TableDesignForeignKey[];
}

export interface TableDesignChange {
  original: TableDesign;
  draft: TableDesign;
}

export interface PreviewSqlRequest {
  connectionId: string;
  change: TableDesignChange;
}

export interface ExecuteSqlRequest extends PreviewSqlRequest {
  sql: string;
}

export interface TableDesignApplyResponse {
  ok: boolean;
  sql: string;
  message?: string;
}

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
  defaultDialect?: DatabaseDriver;
  allowWriteSql?: boolean;
  appendLimit?: boolean;
}

export interface AppSettings {
  aiProviders: AiProviderConfig[];
  defaultAiProviderId?: string;
  theme?: AppTheme;
  selectedDatabasesByConnection?: Record<string, string[]>;
}

export interface DbmindApi {
  getConnections(): Promise<DbConnectionConfig[]>;
  saveConnection(config: DbConnectionConfig): Promise<DbConnectionConfig[]>;
  deleteConnection(id: string): Promise<DbConnectionConfig[]>;
  testConnection(config: DbConnectionConfig): Promise<{ ok: boolean; message: string }>;
  listDatabases(config: DbConnectionConfig): Promise<DatabaseInfo[]>;
  getSchema(connectionId: string, database?: string): Promise<TableSchema[]>;
  getTableDdl(connectionId: string, tableName: string, database?: string): Promise<string>;
  runQuery(connectionId: string, sql: string, database?: string): Promise<QueryResult>;
  updateCell(request: UpdateCellRequest): Promise<UpdateCellResponse>;
  updateCellsBatch(request: BatchUpdateCellRequest): Promise<BatchUpdateCellResponse>;
  getTableDesign(connectionId: string, database: string, table: string): Promise<TableDesign>;
  previewTableDesign(request: PreviewSqlRequest): Promise<string>;
  applyTableDesign(request: ExecuteSqlRequest): Promise<TableDesignApplyResponse>;
  getQueryHistory(): Promise<QueryHistoryItem[]>;
  clearQueryHistory(): Promise<QueryHistoryItem[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  testAiProvider(config: AiProviderConfig): Promise<{ ok: boolean; message: string }>;
  generateSql(input: AiGenerateRequest): Promise<AiGenerateResponse>;
  optimizeSql(input: AiOptimizeRequest): Promise<AiOptimizeResponse>;
  listAiConversations(): Promise<AiConversation[]>;
  saveAiConversation(conversation: AiConversation): Promise<AiConversation[]>;
  deleteAiConversation(id: string): Promise<AiConversation[]>;
  clearAiConversations(): Promise<AiConversation[]>;
}
