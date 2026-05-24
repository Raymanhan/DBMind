import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AppSettings,
  DbConnectionConfig,
  DbmindApi,
  QueryResult,
  TableSchema
} from '../shared/types';
import { addLimitIfSelect, localSqlFromPrompt, validateSql } from '../shared/sqlTools';

let settings: AppSettings = {
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
      streaming: false,
      defaultDialect: 'mysql',
      allowWriteSql: false,
      appendLimit: true
    }
  ]
};

function browserOnlyError(): Error {
  return new Error('请使用 Electron 桌面应用连接数据库；浏览器预览不会访问本机数据库或保存敏感配置。');
}

export const browserFallbackApi: DbmindApi = {
  async getConnections() {
    return [];
  },
  async saveConnection(_config: DbConnectionConfig) {
    throw browserOnlyError();
  },
  async deleteConnection() {
    return [];
  },
  async testConnection() {
    throw browserOnlyError();
  },
  async listDatabases() {
    throw browserOnlyError();
  },
  async getSchema(): Promise<TableSchema[]> {
    return [];
  },
  async getTableDdl() {
    throw browserOnlyError();
  },
  async runQuery(): Promise<QueryResult> {
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
    return { ok: false, message: '请在 Electron 桌面应用中测试 AI 配置。' };
  },
  async generateSql(input: AiGenerateRequest): Promise<AiGenerateResponse> {
    const sql = addLimitIfSelect(localSqlFromPrompt(input.prompt, input.tables, input.dialect));
    return {
      sql,
      explanation: '浏览器预览仅验证界面；桌面应用会使用设置页中的 AI Provider。',
      usedTables: input.tables.map((table) => table.name),
      source: 'local',
      warnings: validateSql(sql)
    };
  }
};
