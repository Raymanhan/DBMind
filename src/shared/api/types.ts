/** Re-export all shared types from Rust for frontend use */

export type DatabaseDriver = 'mysql' | 'postgres' | 'sqlite';

export interface ConnectionConfig {
  id: string;
  name: string;
  driver: DatabaseDriver;
  host: string;
  port: number;
  username: string;
  password?: string;
  database?: string;
  ssl: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_key?: string;
  extra_params: Record<string, string>;
}

export interface ColumnMeta {
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  default_value?: string;
  comment?: string;
  max_length?: number;
  decimal_digits?: number;
}

export type CellValue =
  | null
  | boolean
  | number
  | string
  | number[];

export interface CellBlock {
  row_start: number;
  col_start: number;
  rows: CellValue[][];
  total_rows?: number;
}

export interface TableSchema {
  database: string;
  schema?: string;
  table: string;
  table_type: string;
  columns: ColumnMeta[];
  indexes: IndexMeta[];
  foreign_keys: ForeignKeyMeta[];
  row_count?: number;
  comment?: string;
}

export interface IndexMeta {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
  index_type: string;
}

export interface ForeignKeyMeta {
  name: string;
  column: string;
  ref_table: string;
  ref_column: string;
}

export type QueryStatus = 'running' | 'ready' | 'error' | 'cancelled';

export interface QueryResultMeta {
  query_id: string;
  columns: ColumnMeta[];
  status: QueryStatus;
  row_count?: number;
  execution_time_ms?: number;
  error?: string;
  affected_rows?: number;
  sql?: string;
  label?: string;
  kind?: 'query' | 'explain';
  statement_index?: number;
  statement_count?: number;
  error_line?: number;
}

export interface QueryHistoryItem {
  id: string;
  sql: string;
  database: string;
  connection_id: string;
  created_at: number;
  duration_ms?: number;
  status: QueryStatus;
  error?: string;
}

export interface TableBrief {
  name: string;
  columns: ColumnBrief[];
  row_count?: number;
  comment?: string;
}

export interface CrossDbTableBrief {
  database: string;
  name: string;
  columns: ColumnBrief[];
  row_count?: number;
  comment?: string;
}

export interface ColumnBrief {
  name: string;
  data_type: string;
  comment?: string;
}

export type AiProvider = 'openai' | 'ollama' | 'compatible';

export interface AiConnection {
  id: string;
  name: string;
  provider: AiProvider;
  api_key?: string;
  api_url?: string;
  model: string;
  max_tokens: number;
  temperature: number;
}

export interface AiConfig {
  connections: AiConnection[];
  activeId: string;
}

export interface AppSettings {
  theme: string;
  locale: string;
  font_size: number;
  tab_size: number;
  ai?: AiConfig;
}
