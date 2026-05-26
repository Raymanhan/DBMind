import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type {
  AiConversation,
  AiGenerateRequest,
  AiGenerateResponse,
  AiHistoryMessage,
  AiOptimizeRequest,
  AiOptimizeResponse,
  AiProviderConfig,
  BatchUpdateCellRequest,
  DbConnectionConfig,
  ExecuteSqlRequest,
  PreviewSqlRequest,
  AppSettings,
  UpdateCellRequest
} from '../src/shared/types.js';
import { addLimitIfSelect, buildSchemaPrompt, localSqlFromPrompt, validateSql } from '../src/shared/sqlTools.js';
import { updateCell, updateCellsBatch } from './services/dataEditor.js';
import { applyTableDesign, getTableDesign, previewTableDesign } from './services/tableDesigner.js';
import {
  readConnections, writeConnections, saveConnection, deleteConnection, getConnection,
  readSettings, writeSettings,
  readQueryHistory, writeQueryHistory, appendQueryHistory,
  readAiConversations, writeAiConversations, saveAiConversation, deleteAiConversation, clearAiConversations,
  defaultAiProvider
} from './services/storageStore.js';
import {
  getSchema, listDatabases, testConnection, runQuery, getTableDdl
} from './services/queryRunner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

// ── AI helpers ──────────────────────────────────────────────────────────────

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function extractJsonObject(text: string): { sql?: string; explanation?: string } | null {
  try {
    return JSON.parse(text) as { sql?: string; explanation?: string };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]) as { sql?: string; explanation?: string };
  }
}

function buildMessagesWithHistory(
  instructions: string,
  history: AiHistoryMessage[] | undefined,
  currentPrompt: string
): { role: string; content: string }[] {
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: instructions }
  ];
  if (history) {
    for (const msg of history) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  messages.push({ role: 'user', content: currentPrompt });
  return messages;
}

function buildDdlPrompt(input: AiGenerateRequest): string {
  if (!input.tableDdls?.length) return buildSchemaPrompt(input.tables, input.dialect);
  return input.tableDdls
    .map((item) => {
      const tableLabel = item.database ? `${item.database}.${item.table}` : item.table;
      return `-- ${tableLabel}\n${item.ddl.trim()}`;
    })
    .join('\n\n');
}

async function callAiProvider(input: AiGenerateRequest, provider: AiProviderConfig): Promise<string | null> {
  const apiKey = provider.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey && provider.provider !== 'ollama') return null;

  const prompt = `数据库方言：${input.dialect}\n\n相关表完整 DDL:\n${buildDdlPrompt(input)}\n\n用户需求：${input.prompt}`;

  const instructions =
    '你是 DBMind 的 SQL 生成引擎。只返回 JSON：{"sql": "...", "explanation": "..."}。必须只使用给定 DDL 中的表和字段。SQL 中的表名必须与 DDL 中给出的完全一致（含反引号引用的库名和表名）。默认生成只读 SELECT，除非用户明确要求写操作且应用配置允许。';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs ?? 30000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const baseUrl = normalizeBaseUrl(provider.baseUrl || defaultAiProvider.baseUrl);
    const isResponses = provider.apiMode === 'responses';
    const endpoint = isResponses ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
    const messages = buildMessagesWithHistory(instructions, input.history, prompt);
    const body = isResponses
      ? {
          model: provider.model,
          instructions,
          input: prompt,
          temperature: provider.temperature,
          max_output_tokens: provider.maxOutputTokens
        }
      : {
          model: provider.model,
          temperature: provider.temperature,
          max_tokens: provider.maxOutputTokens,
          messages
        };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`AI 请求失败：${response.status} ${await response.text()}`);
    const data = (await response.json()) as {
      output_text?: string;
      choices?: { message?: { content?: string } }[];
    };
    return data.output_text ?? data.choices?.[0]?.message?.content ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateSql(input: AiGenerateRequest): Promise<AiGenerateResponse> {
  let source: AiGenerateResponse['source'] = 'local';
  let sql = localSqlFromPrompt(input.prompt, input.tables, input.dialect);
  let explanation = '已根据 @table 引用的表结构生成 SQL。未配置可用 AI Provider 时使用本地规则生成器。';

  try {
    const settings = await readSettings();
    const provider =
      settings.aiProviders.find((item) => item.id === settings.defaultAiProviderId) ?? settings.aiProviders[0];
    const output = provider ? await callAiProvider(input, provider) : null;
    if (output) {
      const parsed = extractJsonObject(output);
      if (parsed?.sql) {
        sql = parsed.sql;
        explanation = parsed.explanation ?? `已通过 ${provider.name} 生成 SQL。`;
        source = provider.provider === 'openai' ? 'openai' : 'openai-compatible';
      }
    }
  } catch (error) {
    explanation = `AI 服务暂不可用，已切换到本地规则生成器。${error instanceof Error ? error.message : ''}`;
  }

  sql = addLimitIfSelect(sql);
  return {
    sql,
    explanation,
    source,
    usedTables: input.tables.map((table) => table.name),
    warnings: validateSql(sql)
  };
}

async function optimizeSql(input: AiOptimizeRequest): Promise<AiOptimizeResponse> {
  const instructions =
    '你是 DBMind 的 SQL 优化引擎。分析给定的 SQL 语句并提供优化建议。只返回 JSON：{"sql": "优化后的 SQL", "explanation": "1. 潜在问题\\n2. 优化措施\\n3. 索引建议"}。保持 SQL 语义不变，仅优化性能、可读性和安全性。';

  const prompt = `数据库方言：${input.dialect}\n\nSchema:\n${buildSchemaPrompt(input.tables, input.dialect)}\n\n原始 SQL：\n${input.sql}`;

  try {
    const settings = await readSettings();
    const provider =
      settings.aiProviders.find((item) => item.id === settings.defaultAiProviderId) ?? settings.aiProviders[0];
    if (!provider) {
      return {
        sql: input.sql,
        explanation: '未配置 AI Provider，无法提供优化建议。',
        source: 'local',
        warnings: validateSql(input.sql)
      };
    }

    const apiKey = provider.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey && provider.provider !== 'ollama') {
      return {
        sql: input.sql,
        explanation: '未配置 API Key，无法提供优化建议。',
        source: 'local',
        warnings: validateSql(input.sql)
      };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), provider.timeoutMs ?? 30000);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    try {
      const baseUrl = normalizeBaseUrl(provider.baseUrl || defaultAiProvider.baseUrl);
      const isResponses = provider.apiMode === 'responses';
      const endpoint = isResponses ? `${baseUrl}/responses` : `${baseUrl}/chat/completions`;
      const body = isResponses
        ? {
            model: provider.model,
            instructions,
            input: prompt,
            temperature: provider.temperature ?? 0.2,
            max_output_tokens: provider.maxOutputTokens ?? 1200
          }
        : {
            model: provider.model,
            temperature: provider.temperature ?? 0.2,
            max_tokens: provider.maxOutputTokens ?? 1200,
            messages: [
              { role: 'system', content: instructions },
              { role: 'user', content: prompt }
            ]
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`AI 请求失败：${response.status} ${await response.text()}`);
      const data = (await response.json()) as {
        output_text?: string;
        choices?: { message?: { content?: string } }[];
      };
      const output = data.output_text ?? data.choices?.[0]?.message?.content ?? null;
      if (output) {
        const parsed = extractJsonObject(output);
        if (parsed?.sql) {
          return {
            sql: parsed.sql,
            explanation: parsed.explanation ?? `已通过 ${provider.name} 优化 SQL。`,
            source: provider.provider === 'openai' ? 'openai' : 'openai-compatible',
            warnings: validateSql(parsed.sql)
          };
        }
      }
      return {
        sql: input.sql,
        explanation: `AI 返回格式异常，无法解析优化结果。原始输出：${output?.slice(0, 200) ?? '空'}`,
        source: 'local',
        warnings: validateSql(input.sql)
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      sql: input.sql,
      explanation: `AI 优化服务不可用：${error instanceof Error ? error.message : '未知错误'}`,
      source: 'local',
      warnings: validateSql(input.sql)
    };
  }
}

async function testAiProvider(config: AiProviderConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const output = await callAiProvider(
      {
        prompt: '生成查询 target_table 表前 1 行的 SQL',
        dialect: 'mysql',
        tables: [
          {
            name: 'target_table',
            columns: [
              { name: 'id', type: 'bigint', primary: true },
              { name: 'created_at', type: 'datetime' }
            ]
          }
        ]
      },
      config
    );
    return { ok: Boolean(output), message: output ? 'AI 配置测试成功。' : 'AI 配置未返回内容。' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'AI 配置测试失败。' };
  }
}

// ── Window ──────────────────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: 'DBMind',
    backgroundColor: '#f7f9fd',
    icon: path.join(__dirname, '../../build/icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 18 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (isDev && devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }
}

// ── IPC Registration ────────────────────────────────────────────────────────

app.whenReady().then(() => {
  // ── Connections ──
  ipcMain.handle('connections:list', readConnections);
  ipcMain.handle('connections:save', async (_event, config: DbConnectionConfig) => saveConnection(config));
  ipcMain.handle('connections:delete', async (_event, id: string) => deleteConnection(id));
  ipcMain.handle('connections:test', async (_event, config: DbConnectionConfig) => testConnection(config));

  // ── Database / Schema ──
  ipcMain.handle('db:databases', async (_event, config: DbConnectionConfig) => listDatabases(config));
  ipcMain.handle('db:schema', async (_event, connectionId: string, database?: string) => {
    const config = await getConnection(connectionId);
    return getSchema(database ? { ...config, database } : config);
  });
  ipcMain.handle('db:table-ddl', async (_event, connectionId: string, tableName: string, database?: string) =>
    getTableDdl(database ? { ...(await getConnection(connectionId)), database } : await getConnection(connectionId), tableName)
  );

  // ── Query ──
  ipcMain.handle('db:query', async (_event, connectionId: string, sql: string, database?: string) =>
    runQuery(await getConnection(connectionId), sql, database)
  );

  // ── Data Editing ──
  ipcMain.handle('db:update-cell', async (_event, request: UpdateCellRequest) => {
    const config = await getConnection(request.connectionId);
    const started = performance.now();
    const response = await updateCell(config, request);
    if (request.execute && response.ok) {
      await appendQueryHistory(
        { ...config, database: request.database },
        response.sql,
        { columns: [], rows: [], rowCount: response.affectedRows ?? 0, durationMs: Math.round(performance.now() - started) },
        'data-edit'
      );
    }
    return response;
  });
  ipcMain.handle('db:update-cells-batch', async (_event, request: BatchUpdateCellRequest) => {
    const config = await getConnection(request.connectionId);
    const started = performance.now();
    const response = await updateCellsBatch(config, request);
    if (request.execute && response.ok) {
      await appendQueryHistory(
        { ...config, database: request.database },
        response.sqls.join('\n'),
        { columns: [], rows: [], rowCount: response.affectedRows ?? 0, durationMs: Math.round(performance.now() - started) },
        'data-edit'
      );
    }
    return response;
  });

  // ── Table Design ──
  ipcMain.handle('db:table-design:get', async (_event, connectionId: string, database: string, table: string) =>
    getTableDesign(await getConnection(connectionId), database, table)
  );
  ipcMain.handle('db:table-design:preview', async (_event, request: PreviewSqlRequest) => {
    await getConnection(request.connectionId);
    return previewTableDesign(request.change);
  });
  ipcMain.handle('db:table-design:apply', async (_event, request: ExecuteSqlRequest) => {
    const config = await getConnection(request.connectionId);
    const started = performance.now();
    const response = await applyTableDesign(config, request.change, request.sql);
    if (response.ok && response.sql.trim()) {
      await appendQueryHistory(
        { ...config, database: request.change.original.database },
        response.sql,
        { columns: [], rows: [], rowCount: 0, durationMs: Math.round(performance.now() - started) },
        'schema-edit'
      );
    }
    return response;
  });

  // ── History ──
  ipcMain.handle('history:list', readQueryHistory);
  ipcMain.handle('history:clear', async () => writeQueryHistory([]));

  // ── AI Conversations ──
  ipcMain.handle('ai:list-conversations', readAiConversations);
  ipcMain.handle('ai:save-conversation', async (_event, conv: AiConversation) => saveAiConversation(conv));
  ipcMain.handle('ai:delete-conversation', async (_event, id: string) => deleteAiConversation(id));
  ipcMain.handle('ai:clear-conversations', clearAiConversations);

  // ── Settings ──
  ipcMain.handle('settings:get', readSettings);
  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => writeSettings(settings));

  // ── AI ──
  ipcMain.handle('ai:test-provider', async (_event, config: AiProviderConfig) => testAiProvider(config));
  ipcMain.handle('ai:generate-sql', async (_event, input: AiGenerateRequest) => generateSql(input));
  ipcMain.handle('ai:optimize-sql', async (_event, input: AiOptimizeRequest) => optimizeSql(input));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
