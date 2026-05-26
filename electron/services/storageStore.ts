import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  AiConversation,
  AiProviderConfig,
  AppSettings,
  DbConnectionConfig,
  QueryHistoryItem,
  QueryResult
} from '../../src/shared/types.js';

// ── File paths ──────────────────────────────────────────────────────────────

const storePath = () => path.join(app.getPath('userData'), 'connections.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const historyPath = () => path.join(app.getPath('userData'), 'query-history.json');
const aiConversationsPath = () => path.join(app.getPath('userData'), 'ai-conversations.json');

// ── Encryption helpers ──────────────────────────────────────────────────────

const ENC_PREFIX = 'enc_safe:';

/**
 * Encrypt a plaintext string using Electron safeStorage.
 * Returns the encrypted value with `enc_safe:` prefix.
 * Falls back to plaintext if safeStorage is unavailable.
 */
function encryptSensitive(plaintext: string | undefined): string | undefined {
  if (!plaintext) return plaintext;
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext; // already encrypted
  if (!safeStorage.isEncryptionAvailable()) return plaintext; // graceful fallback
  const encrypted = safeStorage.encryptString(plaintext);
  return ENC_PREFIX + encrypted.toString('base64');
}

/**
 * Decrypt an `enc_safe:` prefixed string using Electron safeStorage.
 * Returns plaintext directly if no prefix is found (backward compatible).
 */
function decryptSensitive(value: string | undefined): string | undefined {
  if (!value) return value;
  if (!value.startsWith(ENC_PREFIX)) return value; // plaintext – backward compatible
  const base64 = value.slice(ENC_PREFIX.length);
  return safeStorage.decryptString(Buffer.from(base64, 'base64'));
}

// ── Default AI provider ─────────────────────────────────────────────────────

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
  defaultDialect: 'mysql',
  allowWriteSql: false,
  appendLimit: true
};

// ── JSON read/write helpers ─────────────────────────────────────────────────

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// ── Connections ─────────────────────────────────────────────────────────────

export async function readConnections(): Promise<DbConnectionConfig[]> {
  const parsed = await readJsonFile<DbConnectionConfig[]>(storePath());
  if (!parsed) return [];
  // Decrypt passwords on read
  return parsed.map((conn) => ({
    ...conn,
    password: decryptSensitive(conn.password)
  }));
}

export async function writeConnections(connections: DbConnectionConfig[]): Promise<DbConnectionConfig[]> {
  // Encrypt passwords on write
  const encrypted = connections.map((conn) => ({
    ...conn,
    password: encryptSensitive(conn.password)
  }));
  await writeJsonFile(storePath(), encrypted);
  return connections; // return original (decrypted) for in-memory use
}

export async function saveConnection(config: DbConnectionConfig): Promise<DbConnectionConfig[]> {
  const connections = await readConnections();
  const id = config.id || crypto.randomUUID();
  const next = [{ ...config, id }, ...connections.filter((item) => item.id !== id)];
  return writeConnections(next);
}

export async function deleteConnection(id: string): Promise<DbConnectionConfig[]> {
  const connections = await readConnections();
  return writeConnections(connections.filter((item) => item.id !== id));
}

export async function getConnection(id: string): Promise<DbConnectionConfig> {
  const connections = await readConnections();
  const found = connections.find((conn) => conn.id === id);
  if (!found) throw new Error(`未找到连接：${id}`);
  return found;
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function readSettings(): Promise<AppSettings> {
  const parsed = await readJsonFile<AppSettings>(settingsPath());
  if (!parsed) {
    return {
      aiProviders: [defaultAiProvider],
      defaultAiProviderId: defaultAiProvider.id,
      theme: 'dark',
      selectedDatabasesByConnection: {}
    };
  }
  const providers = parsed.aiProviders?.length ? parsed.aiProviders : [defaultAiProvider];
  // Decrypt API keys on read
  const decryptedProviders = providers.map((p) => ({
    ...p,
    apiKey: decryptSensitive(p.apiKey)
  }));
  return {
    aiProviders: decryptedProviders,
    defaultAiProviderId: parsed.defaultAiProviderId ?? decryptedProviders[0]?.id,
    theme: parsed.theme ?? 'dark',
    selectedDatabasesByConnection: parsed.selectedDatabasesByConnection ?? {}
  };
}

export async function writeSettings(settings: AppSettings): Promise<AppSettings> {
  const next: AppSettings = {
    aiProviders: settings.aiProviders.length ? settings.aiProviders : [defaultAiProvider],
    defaultAiProviderId: settings.defaultAiProviderId ?? settings.aiProviders[0]?.id ?? defaultAiProvider.id,
    theme: settings.theme ?? 'dark',
    selectedDatabasesByConnection: settings.selectedDatabasesByConnection ?? {}
  };
  // Encrypt API keys on write
  const encrypted: AppSettings = {
    ...next,
    aiProviders: next.aiProviders.map((p) => ({
      ...p,
      apiKey: encryptSensitive(p.apiKey)
    }))
  };
  await writeJsonFile(settingsPath(), encrypted);
  return next; // return original (decrypted) for in-memory use
}

// ── Query History ───────────────────────────────────────────────────────────

export async function readQueryHistory(): Promise<QueryHistoryItem[]> {
  return (await readJsonFile<QueryHistoryItem[]>(historyPath())) ?? [];
}

export async function writeQueryHistory(history: QueryHistoryItem[]): Promise<QueryHistoryItem[]> {
  const next = history.slice(0, 200);
  await writeJsonFile(historyPath(), next);
  return next;
}

export async function appendQueryHistory(
  config: DbConnectionConfig,
  sql: string,
  result: QueryResult,
  source: QueryHistoryItem['source'] = 'query'
): Promise<void> {
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

// ── AI Conversations ────────────────────────────────────────────────────────

export async function readAiConversations(): Promise<AiConversation[]> {
  return (await readJsonFile<AiConversation[]>(aiConversationsPath())) ?? [];
}

export async function writeAiConversations(conversations: AiConversation[]): Promise<AiConversation[]> {
  const next = conversations.slice(0, 200);
  await writeJsonFile(aiConversationsPath(), next);
  return next;
}

export async function saveAiConversation(conv: AiConversation): Promise<AiConversation[]> {
  const conversations = await readAiConversations();
  const idx = conversations.findIndex((c) => c.id === conv.id);
  const next = idx >= 0
    ? conversations.map((c, i) => (i === idx ? conv : c))
    : [conv, ...conversations];
  return writeAiConversations(next);
}

export async function deleteAiConversation(id: string): Promise<AiConversation[]> {
  const conversations = await readAiConversations();
  return writeAiConversations(conversations.filter((c) => c.id !== id));
}

export async function clearAiConversations(): Promise<AiConversation[]> {
  return writeAiConversations([]);
}

// Re-export default provider for AI service usage
export { defaultAiProvider };
