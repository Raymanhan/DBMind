import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import pg from 'pg';
import type {
  AiGenerateRequest,
  AiGenerateResponse,
  AiProviderConfig,
  AppSettings,
  BatchUpdateCellRequest,
  DatabaseInfo,
  DbConnectionConfig,
  QueryHistoryItem,
  QueryResult,
  TableSchema,
  UpdateCellRequest,
  PreviewSqlRequest,
  ExecuteSqlRequest
} from '../src/shared/types.js';
import { addLimitIfSelect, buildSchemaPrompt, localSqlFromPrompt, validateSql } from '../src/shared/sqlTools.js';
import { updateCell, updateCellsBatch } from './services/dataEditor.js';
import { applyTableDesign, getTableDesign, previewTableDesign } from './services/tableDesigner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged;
const storePath = () => path.join(app.getPath('userData'), 'connections.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const historyPath = () => path.join(app.getPath('userData'), 'query-history.json');

let mainWindow: BrowserWindow | null = null;

const defaultAiProvider: AiProviderConfig = {
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
};

async function readConnections(): Promise<DbConnectionConfig[]> {
  try {
    const raw = await fs.readFile(storePath(), 'utf-8');
    const parsed = JSON.parse(raw) as DbConnectionConfig[];
    return parsed;
  } catch {
    return [];
  }
}

async function writeConnections(connections: DbConnectionConfig[]): Promise<DbConnectionConfig[]> {
  await fs.mkdir(path.dirname(storePath()), { recursive: true });
  await fs.writeFile(storePath(), JSON.stringify(connections, null, 2));
  return connections;
}

async function readSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as AppSettings;
    const providers = parsed.aiProviders?.length ? parsed.aiProviders : [defaultAiProvider];
    return {
      aiProviders: providers,
      defaultAiProviderId: parsed.defaultAiProviderId ?? providers[0]?.id,
      theme: parsed.theme ?? 'dark',
      selectedDatabasesByConnection: parsed.selectedDatabasesByConnection ?? {}
    };
  } catch {
    return {
      aiProviders: [defaultAiProvider],
      defaultAiProviderId: defaultAiProvider.id,
      theme: 'dark',
      selectedDatabasesByConnection: {}
    };
  }
}

async function writeSettings(settings: AppSettings): Promise<AppSettings> {
  const next: AppSettings = {
    aiProviders: settings.aiProviders.length ? settings.aiProviders : [defaultAiProvider],
    defaultAiProviderId: settings.defaultAiProviderId ?? settings.aiProviders[0]?.id ?? defaultAiProvider.id,
    theme: settings.theme ?? 'dark',
    selectedDatabasesByConnection: settings.selectedDatabasesByConnection ?? {}
  };
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

async function readQueryHistory(): Promise<QueryHistoryItem[]> {
  try {
    const raw = await fs.readFile(historyPath(), 'utf-8');
    return JSON.parse(raw) as QueryHistoryItem[];
  } catch {
    return [];
  }
}

async function writeQueryHistory(history: QueryHistoryItem[]): Promise<QueryHistoryItem[]> {
  const next = history.slice(0, 200);
  await fs.mkdir(path.dirname(historyPath()), { recursive: true });
  await fs.writeFile(historyPath(), JSON.stringify(next, null, 2));
  return next;
}

async function appendQueryHistory(config: DbConnectionConfig, sql: string, result: QueryResult, source: QueryHistoryItem['source'] = 'query'): Promise<void> {
  const history = await readQueryHistory();
  await writeQueryHistory([
    {
      id: crypto.randomUUID(),
      connectionId: config.id,
      connectionName: config.name,
      database: config.database,
      sql,
      source,
      rowCount: result.rowCount,
      durationMs: result.durationMs,
      createdAt: new Date().toISOString()
    },
    ...history
  ]);
}

async function getConnection(id: string): Promise<DbConnectionConfig> {
  const connections = await readConnections();
  const found = connections.find((connection) => connection.id === id);
  if (!found) throw new Error(`未找到连接：${id}`);
  return found;
}

function mysqlConnectionOptions(config: DbConnectionConfig): mysql.ConnectionOptions {
  return {
    host: config.host || 'localhost',
    port: config.port || 3306,
    user: config.user,
    password: config.password,
    database: config.database || undefined,
    charset: config.charset || 'utf8mb4',
    timezone: config.timezone || 'local',
    connectTimeout: config.connectTimeout || 10000,
    ssl: config.ssl ? {} : undefined
  };
}

function quoteMysqlIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

async function getSchema(config: DbConnectionConfig): Promise<TableSchema[]> {
  if (config.driver === 'mysql') {
    const connection = await mysql.createConnection(mysqlConnectionOptions(config));
    const [rows] = await connection.query(
      `SELECT
         c.TABLE_NAME tableName,
         t.TABLE_TYPE tableType,
         t.TABLE_ROWS tableRows,
         t.TABLE_COMMENT tableComment,
         t.ENGINE engine,
         t.TABLE_COLLATION collation,
         c.COLUMN_NAME columnName,
         c.COLUMN_TYPE columnType,
         c.IS_NULLABLE nullable,
         c.COLUMN_KEY columnKey,
         c.COLUMN_DEFAULT columnDefault,
         c.COLUMN_COMMENT columnComment,
         c.EXTRA extra,
         kcu.REFERENCED_TABLE_NAME referencedTable,
         kcu.REFERENCED_COLUMN_NAME referencedColumn
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t
         ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
       LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON kcu.TABLE_SCHEMA = c.TABLE_SCHEMA
        AND kcu.TABLE_NAME = c.TABLE_NAME
        AND kcu.COLUMN_NAME = c.COLUMN_NAME
        AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
       WHERE c.TABLE_SCHEMA = ?
       ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
      [config.database]
    );
    await connection.end();
    return groupSchemaRows(rows as Record<string, string>[]);
  }

  const client = new pg.Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined
  });
  await client.connect();
  const result = await client.query(`
    SELECT table_name AS "tableName", column_name AS "columnName", data_type AS "columnType",
           is_nullable AS nullable, '' AS "columnKey"
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  await client.end();
  return groupSchemaRows(result.rows);
}

function groupSchemaRows(rows: Record<string, string>[]): TableSchema[] {
  const map = new Map<string, TableSchema>();
  for (const row of rows) {
    const tableName = row.tableName;
    if (!map.has(tableName)) {
      map.set(tableName, {
        name: tableName,
        type: row.tableType === 'VIEW' ? 'view' : 'table',
        rowCount: Number(row.tableRows || 0) || undefined,
        comment: row.tableComment || undefined,
        engine: row.engine || undefined,
        collation: row.collation || undefined,
        columns: []
      });
    }
    map.get(tableName)?.columns.push({
      name: row.columnName,
      type: row.columnType,
      nullable: row.nullable === 'YES',
      primary: row.columnKey === 'PRI',
      indexed: Boolean(row.columnKey),
      defaultValue: row.columnDefault ?? null,
      comment: row.columnComment || undefined,
      extra: row.extra || undefined,
      references: row.referencedTable && row.referencedColumn ? `${row.referencedTable}.${row.referencedColumn}` : undefined
    });
  }
  return [...map.values()];
}

async function listDatabases(config: DbConnectionConfig): Promise<DatabaseInfo[]> {
  if (config.driver === 'postgres') return [{ name: config.database || 'public', system: false }];

  const connection = await mysql.createConnection(mysqlConnectionOptions({ ...config, database: undefined }));
  const [rows] = await connection.query('SHOW DATABASES');
  await connection.end();
  const systemDatabases = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
  return (rows as Record<string, string>[]).map((row) => {
    const name = row.Database ?? Object.values(row)[0];
    return { name, system: systemDatabases.has(name) };
  });
}

async function testConnection(config: DbConnectionConfig): Promise<{ ok: boolean; message: string }> {
  try {
    if (config.driver === 'mysql') {
      const connection = await mysql.createConnection(mysqlConnectionOptions({ ...config, database: undefined }));
      await connection.ping();
      await connection.end();
      const databases = await listDatabases(config);
      const userDatabaseCount = databases.filter((database) => !database.system).length;
      if (!config.database) {
        return {
          ok: true,
          message: `服务器连接成功，读取到 ${databases.length} 个数据库，其中 ${userDatabaseCount} 个用户数据库。请选择数据库后保存。`
        };
      }
      const schema = await getSchema(config);
      return { ok: true, message: `连接成功，当前库读取到 ${schema.length} 个对象。` };
    }

    const client = new pg.Client({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined
    });
    await client.connect();
    await client.end();
    return { ok: true, message: 'PostgreSQL 连接成功。' };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '连接失败' };
  }
}

async function runQuery(config: DbConnectionConfig, sql: string, database?: string): Promise<QueryResult> {
  const targetDb = database || config.database;
  const resolvedConfig = targetDb ? { ...config, database: targetDb } : config;
  const started = performance.now();
  if (config.driver === 'mysql') {
    if (config.readonly && !/^\s*(select|show|describe|desc|explain)\b/i.test(sql)) {
      throw new Error('当前连接为只读模式，已阻止写操作。');
    }
    const connection = await mysql.createConnection(mysqlConnectionOptions(resolvedConfig));
    const [rows, fields] = await connection.query(sql);
    await connection.end();
    const records = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    const result = {
      columns: fields?.map((field) => field.name) ?? Object.keys(records[0] ?? {}),
      rows: records,
      rowCount: records.length,
      durationMs: Math.round(performance.now() - started)
    };
    await appendQueryHistory(resolvedConfig, sql, result);
    return result;
  }

  const client = new pg.Client({
    host: resolvedConfig.host,
    port: resolvedConfig.port,
    user: resolvedConfig.user,
    password: resolvedConfig.password,
    database: resolvedConfig.database,
    ssl: resolvedConfig.ssl ? { rejectUnauthorized: false } : undefined
  });
  await client.connect();
  const result = await client.query(sql);
  await client.end();
  const queryResult = {
    columns: result.fields.map((field) => field.name),
    rows: result.rows,
    rowCount: result.rowCount ?? result.rows.length,
    durationMs: Math.round(performance.now() - started)
  };
  await appendQueryHistory(resolvedConfig, sql, queryResult);
  return queryResult;
}

async function getTableDdl(config: DbConnectionConfig, tableName: string): Promise<string> {
  if (config.driver !== 'mysql') {
    throw new Error('当前仅 MySQL 支持读取建表 DDL。');
  }
  const connection = await mysql.createConnection(mysqlConnectionOptions(config));
  const [rows] = await connection.query(`SHOW CREATE TABLE ${quoteMysqlIdentifier(tableName)}`);
  await connection.end();
  const record = (rows as Record<string, string>[])[0];
  return record?.['Create Table'] ?? record?.['Create View'] ?? '';
}

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

  const prompt = `数据库方言：${input.dialect}

Schema:
${buildSchemaPrompt(input.tables, input.dialect)}

用户需求：${input.prompt}`;

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: 'DBMind',
    backgroundColor: '#0a0a0f',
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

app.whenReady().then(() => {
  ipcMain.handle('connections:list', readConnections);
  ipcMain.handle('connections:save', async (_event, config: DbConnectionConfig) => {
    const connections = await readConnections();
    const id = config.id || crypto.randomUUID();
    const next = [{ ...config, id }, ...connections.filter((item) => item.id !== id)];
    return writeConnections(next);
  });
  ipcMain.handle('connections:delete', async (_event, id: string) => {
    const connections = await readConnections();
    return writeConnections(connections.filter((item) => item.id !== id));
  });
  ipcMain.handle('connections:test', async (_event, config: DbConnectionConfig) => {
    return testConnection(config);
  });
  ipcMain.handle('db:databases', async (_event, config: DbConnectionConfig) => listDatabases(config));
  ipcMain.handle('db:schema', async (_event, connectionId: string, database?: string) => {
    const config = await getConnection(connectionId);
    return getSchema(database ? { ...config, database } : config);
  });
  ipcMain.handle('db:table-ddl', async (_event, connectionId: string, tableName: string) =>
    getTableDdl(await getConnection(connectionId), tableName)
  );
  ipcMain.handle('db:query', async (_event, connectionId: string, sql: string, database?: string) => runQuery(await getConnection(connectionId), sql, database));
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
    if (response.ok && request.sql.trim()) {
      await appendQueryHistory(
        { ...config, database: request.change.original.database },
        request.sql,
        { columns: [], rows: [], rowCount: 0, durationMs: Math.round(performance.now() - started) },
        'schema-edit'
      );
    }
    return response;
  });
  ipcMain.handle('history:list', readQueryHistory);
  ipcMain.handle('history:clear', async () => writeQueryHistory([]));
  ipcMain.handle('settings:get', readSettings);
  ipcMain.handle('settings:save', async (_event, settings: AppSettings) => writeSettings(settings));
  ipcMain.handle('ai:test-provider', async (_event, config: AiProviderConfig) => testAiProvider(config));
  ipcMain.handle('ai:generate-sql', async (_event, input: AiGenerateRequest) => generateSql(input));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
