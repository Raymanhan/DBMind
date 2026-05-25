import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type {
  AiConversation,
  AiGenerateRequest,
  AiGenerateResponse,
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

async function callAiProvider(input: AiGenerateRequest, provider: AiProviderConfig): Promise<string | null> {
  const apiKey = provider.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey && provider.provider !== 'ollama') return null;

  const prompt = `数据库方言：${input.dialect}\n\nSchema:\n${buildSchemaPrompt(input.tables, input.dialect)}\n\n用户需求：${input.prompt}`;

  const instructions =
    '你是 DBMind 的 SQL 生成引擎。只返回 JSON：{"sql": "...", "explanation": "..."}。必须只使用给定 schema 中的表和字段。SQL 中的表名必须与 schema 中给出的完全一致（含反引号引用的库名和表名）。默认生成只读 SELECT，除非用户明确要求写操作且应用配置允许。';

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
          temperature: provider.temperature,
          max_output_tokens: provider.maxOutputTokens
        }
      : {
          model: provider.model,
          temperature: provider.temperature,
          max_tokens: provider.maxOutputTokens,
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
    return data.output_text ?? data.choices?.[0]?.message?.content ?? null;
  } finally {
    clearTimeout(timeout);
  }
}

async function* callAiProviderStream(input: AiGenerateRequest, provider: AiProviderConfig): AsyncGenerator<string> {
  const apiKey = provider.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey && provider.provider !== 'ollama') {
    yield JSON.stringify({ error: '未配置 API Key' });
    return;
  }

  const prompt = `数据库方言：${input.dialect}\n\nSchema:\n${buildSchemaPrompt(input.tables, input.dialect)}\n\n用户需求：${input.prompt}`;

  const instructions =
    '你是 DBMind 的 SQL 生成引擎。只返回 JSON：{"sql": "...", "explanation": "..."}。必须只使用给定 schema 中的表和字段。SQL 中的表名必须与 schema 中给出的完全一致（含反引号引用的库名和表名）。默认生成只读 SELECT，除非用户明确要求写操作且应用配置允许。';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const baseUrl = normalizeBaseUrl(provider.baseUrl || defaultAiProvider.baseUrl);
    const endpoint = `${baseUrl}/chat/completions`;

    const body = {
      model: provider.model,
      temperature: provider.temperature,
      max_tokens: provider.maxOutputTokens,
      stream: true,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: prompt }
      ]
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      yield JSON.stringify({ error: `AI 请求失败：${response.status}` });
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) { yield JSON.stringify({ error: '无法读取流式响应' }); return; }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) yield content;
          } catch { /* skip unparseable chunks */ }
        }
      }
    }

    if (buffer.startsWith('data: ') && buffer.slice(6).trim() !== '[DONE]') {
      try {
        const parsed = JSON.parse(buffer.slice(6).trim()) as { choices?: { delta?: { content?: string } }[] };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch { /* skip */ }
    }
  } catch (error) {
    yield JSON.stringify({ error: error instanceof Error ? error.message : '流式请求失败' });
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
  ipcMain.on('ai:generate-sql-stream', async (event, payload: AiGenerateRequest | { requestId?: string; input: AiGenerateRequest }) => {
    const requestId = 'input' in payload ? payload.requestId : undefined;
    const input = 'input' in payload ? payload.input : payload;
    const replyChannel = requestId ? `ai:stream-chunk:${requestId}` : 'ai:stream-chunk';
    const sendChunk = (chunk: import('../src/shared/types.js').AiStreamChunk) => {
      event.sender.send(replyChannel, chunk);
    };
    try {
      const settings = await readSettings();
      const provider = settings.aiProviders.find((item) => item.id === settings.defaultAiProviderId) ?? settings.aiProviders[0];
      if (!provider || !provider.streaming) {
        const result = await generateSql(input);
        sendChunk({ done: true, sql: result.sql, explanation: result.explanation, source: result.source, usedTables: result.usedTables, warnings: result.warnings });
        return;
      }

      let fullText = '';
      for await (const chunk of callAiProviderStream(input, provider)) {
        try {
          const err = JSON.parse(chunk) as { error?: string };
          if (err.error) {
            sendChunk({ error: err.error });
            return;
          }
        } catch {}
        fullText += chunk;
        sendChunk({ token: chunk });
      }

      const parsed = extractJsonObject(fullText);
      let sql = localSqlFromPrompt(input.prompt, input.tables, input.dialect);
      let explanation = '已根据 @table 引用的表结构生成 SQL。';
      let source: AiGenerateResponse['source'] = 'local';
      if (parsed?.sql) {
        sql = parsed.sql;
        explanation = parsed.explanation ?? `已通过 ${provider.name} 生成 SQL。`;
        source = provider.provider === 'openai' ? 'openai' : 'openai-compatible';
      }
      sql = addLimitIfSelect(sql);
      sendChunk({
        done: true, sql, explanation, source,
        usedTables: input.tables.map((t) => t.name),
        warnings: validateSql(sql)
      });
    } catch (error) {
      sendChunk({ error: error instanceof Error ? error.message : 'AI 生成失败' });
    }
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
