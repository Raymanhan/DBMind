import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AiOptimizeRequest,
  AiOptimizeResponse,
  AppSettings,
  DbConnectionConfig,
  DbmindApi,
  QueryResult,
  TableSchema
} from '../shared/types';
import { addLimitIfSelect, localSqlFromPrompt, validateSql } from '../shared/sqlTools';

const demoConnection: DbConnectionConfig = {
  id: 'browser-demo',
  name: '123',
  driver: 'mysql',
  host: 'localhost',
  port: 3306,
  database: 'yingyan',
  user: 'root',
  password: '',
  charset: 'utf8mb4',
  timezone: 'local',
  connectTimeout: 10000,
  readonly: false,
  ssl: false
};

const demoSchemas: Record<string, TableSchema[]> = {
  yingyan: [
    { name: 'canvas_cards', type: 'table', columns: Array.from({ length: 15 }, (_, i) => ({ name: `field_${i + 1}`, type: 'varchar(255)', nullable: true, primary: false })) },
    { name: 'card_likes', type: 'table', columns: Array.from({ length: 8 }, (_, i) => ({ name: `field_${i + 1}`, type: 'varchar(255)', nullable: true, primary: false })) },
    { name: 'sys_user', type: 'table', columns: [
      { name: 'id', type: 'bigint', nullable: false, primary: true },
      { name: 'tenant_id', type: 'varchar(64)', nullable: false, primary: false },
      { name: 'status', type: 'varchar(32)', nullable: false, primary: false },
      { name: 'profile', type: 'json', nullable: true, primary: false },
      { name: 'memo', type: 'text', nullable: true, primary: false },
      { name: 'updated_at', type: 'datetime', nullable: false, primary: false }
    ] }
  ],
  test: [
    { name: 'sys_users', type: 'table', columns: Array.from({ length: 9 }, (_, i) => ({ name: `field_${i + 1}`, type: 'varchar(255)', nullable: true, primary: false })) }
  ],
  ym_rag: [
    { name: 'checkpoint_blobs', type: 'table', columns: Array.from({ length: 7 }, (_, i) => ({ name: `field_${i + 1}`, type: 'varchar(255)', nullable: true, primary: false })) },
    { name: 'checkpoint_milvus', type: 'table', columns: Array.from({ length: 1 }, (_, i) => ({ name: `field_${i + 1}`, type: 'varchar(255)', nullable: true, primary: false })) },
    { name: 'checkpoint_wiki', type: 'table', columns: Array.from({ length: 10 }, (_, i) => ({ name: `field_${i + 1}`, type: 'varchar(255)', nullable: true, primary: false })) },
    { name: 'checkpoints', type: 'table', columns: Array.from({ length: 8 }, (_, i) => ({ name: `field_${i + 1}`, type: 'varchar(255)', nullable: true, primary: false })) },
    { name: 'conversation', type: 'table', columns: Array.from({ length: 9 }, (_, i) => ({ name: `field_${i + 1}`, type: 'varchar(255)', nullable: true, primary: false })) }
  ]
};

let settings: AppSettings = {
  theme: 'light',
  language: 'zh-CN',
  selectedDatabasesByConnection: { [demoConnection.id]: ['yingyan', 'test', 'ym_rag'] },
  defaultAiProviderId: 'openai-compatible-default',
  aiProviders: [
    {
      id: 'openai-compatible-default',
      name: 'OpenAI Compatible',
      provider: 'openai-compatible',
      apiMode: 'chat-completions',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5-mini',
      temperature: 0.2,
      maxOutputTokens: 1200,
      timeoutMs: 30000,
      defaultDialect: 'mysql',
      allowWriteSql: false,
      appendLimit: true
    }
  ]
};

function previewText(zh: string, en: string): string {
  return settings.language === 'zh-CN' || settings.language === 'zh-TW' ? zh : en;
}

function browserOnlyError(): Error {
  return new Error(previewText(
    '请使用 Electron 桌面应用连接数据库；浏览器预览不会访问本机数据库或保存敏感配置。',
    'Use the Electron desktop app to connect to databases. Browser preview does not access local databases or save sensitive configuration.'
  ));
}

export const browserFallbackApi: DbmindApi = {
  async getConnections() {
    return [demoConnection];
  },
  async saveConnection(_config: DbConnectionConfig) {
    throw browserOnlyError();
  },
  async deleteConnection() {
    return [demoConnection];
  },
  async testConnection() {
    throw browserOnlyError();
  },
  async listDatabases() {
    return Object.keys(demoSchemas).map((name) => ({ name, system: false }));
  },
  async getSchema(_connectionId: string, _database?: string): Promise<TableSchema[]> {
    const databaseName = _database ?? demoConnection.database ?? 'yingyan';
    return demoSchemas[databaseName] ?? [];
  },
  async getTableDdl(_connectionId: string, tableName: string, database?: string) {
    const schema = (demoSchemas[database ?? demoConnection.database ?? 'yingyan'] ?? []).find((table) => table.name === tableName);
    if (!schema) return '';
    const columns = schema.columns.map((column) => {
      const nullable = column.nullable === false ? ' NOT NULL' : '';
      const primary = column.primary ? ' PRIMARY KEY' : '';
      return `  \`${column.name}\` ${column.type}${nullable}${primary}`;
    });
    return `CREATE TABLE \`${schema.name}\` (\n${columns.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
  },
  async runQuery(_connectionId: string, _sql: string, _database?: string): Promise<QueryResult> {
    return {
      columns: ['id', 'count', 'tenant_id', 'profile', 'memo', 'updated_at'],
      rows: Array.from({ length: 10 }, (_, index) => ({
        id: index + 1,
        count: [128, 96, 74, 63, 51, 47, 38, 29, 21, 15][index],
        tenant_id: `tenant_${String(index + 1).padStart(3, '0')}`,
        profile: JSON.stringify({ tier: index < 3 ? 'vip' : 'standard', active: true, score: 100 - index }),
        memo: previewText(`这是一段用于验证长文本编辑器的备注内容。第 ${index + 1} 行包含较长文本，避免窄列行内输入时出现挤压或换行。`, `Long text editor preview content. Row ${index + 1} contains longer text to validate narrow-cell editing.`),
        updated_at: '2024-05-23 16:48:21'
      })),
      rowCount: 10,
      durationMs: 22
    };
  },
  async updateCell() {
    throw browserOnlyError();
  },
  async updateCellsBatch(input) {
    return {
      sqls: input.edits.map((edit) => `UPDATE \`${input.database}\`.\`${input.table}\` SET \`${edit.column}\` = ${edit.value === null ? 'NULL' : '?'} WHERE /* primary key */;`),
      ok: Boolean(input.execute),
      affectedRows: input.execute ? input.edits.length : undefined
    };
  },
  async getTableDesign() {
    throw browserOnlyError();
  },
  async previewTableDesign() {
    throw browserOnlyError();
  },
  async applyTableDesign() {
    throw browserOnlyError();
  },
  async getQueryHistory() {
    return [];
  },
  async clearQueryHistory() {
    return [];
  },
  async getSettings() {
    return settings;
  },
  async saveSettings(input) {
    settings = input;
    return settings;
  },
  async testAiProvider() {
    return { ok: false, message: previewText('请在 Electron 桌面应用中测试 AI 配置。', 'Use the Electron desktop app to test AI configuration.') };
  },
  async generateSql(input: AiGenerateRequest): Promise<AiGenerateResponse> {
    const sql = addLimitIfSelect(localSqlFromPrompt(input.prompt, input.tables, input.dialect));
    return {
      sql,
      explanation: previewText('浏览器预览仅验证界面；桌面应用会使用设置页中的 AI Provider。', 'Browser preview only validates the interface. The desktop app uses the AI Provider configured in Settings.'),
      usedTables: input.tables.map((table) => table.name),
      source: 'local',
      warnings: validateSql(sql)
    };
  },
  async optimizeSql(input: AiOptimizeRequest): Promise<AiOptimizeResponse> {
    return {
      sql: input.sql,
      explanation: previewText('浏览器预览不支持 AI 优化；桌面应用会使用设置页中的 AI Provider 进行 SQL 优化。', 'Browser preview does not support AI optimization. The desktop app uses the AI Provider configured in Settings for SQL optimization.'),
      source: 'local',
      warnings: validateSql(input.sql)
    };
  },
  async listAiConversations() { return []; },
  async saveAiConversation() { return []; },
  async deleteAiConversation() { return []; },
  async clearAiConversations() { return []; }
};
