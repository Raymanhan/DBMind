import { contextBridge, ipcRenderer } from 'electron';
import type { AiGenerateRequest, AiProviderConfig, AppSettings, BatchUpdateCellRequest, DbConnectionConfig, DbmindApi, ExecuteSqlRequest, PreviewSqlRequest, UpdateCellRequest } from '../src/shared/types.js';

const api: DbmindApi = {
  getConnections: () => ipcRenderer.invoke('connections:list'),
  saveConnection: (config: DbConnectionConfig) => ipcRenderer.invoke('connections:save', config),
  deleteConnection: (id: string) => ipcRenderer.invoke('connections:delete', id),
  testConnection: (config: DbConnectionConfig) => ipcRenderer.invoke('connections:test', config),
  listDatabases: (config: DbConnectionConfig) => ipcRenderer.invoke('db:databases', config),
  getSchema: (connectionId: string, database?: string) => ipcRenderer.invoke('db:schema', connectionId, database),
  getTableDdl: (connectionId: string, tableName: string) => ipcRenderer.invoke('db:table-ddl', connectionId, tableName),
  runQuery: (connectionId: string, sql: string, database?: string) => ipcRenderer.invoke('db:query', connectionId, sql, database),
  updateCell: (request: UpdateCellRequest) => ipcRenderer.invoke('db:update-cell', request),
  updateCellsBatch: (request: BatchUpdateCellRequest) => ipcRenderer.invoke('db:update-cells-batch', request),
  getTableDesign: (connectionId: string, database: string, table: string) => ipcRenderer.invoke('db:table-design:get', connectionId, database, table),
  previewTableDesign: (request: PreviewSqlRequest) => ipcRenderer.invoke('db:table-design:preview', request),
  applyTableDesign: (request: ExecuteSqlRequest) => ipcRenderer.invoke('db:table-design:apply', request),
  getQueryHistory: () => ipcRenderer.invoke('history:list'),
  clearQueryHistory: () => ipcRenderer.invoke('history:clear'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  testAiProvider: (config: AiProviderConfig) => ipcRenderer.invoke('ai:test-provider', config),
  generateSql: (input: AiGenerateRequest) => ipcRenderer.invoke('ai:generate-sql', input)
};

contextBridge.exposeInMainWorld('dbmind', api);
