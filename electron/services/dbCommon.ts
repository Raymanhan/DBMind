import mysql from 'mysql2/promise';
import pg from 'pg';
import type { DbConnectionConfig, QueryHistoryItem, QueryResult } from '../../src/shared/types.js';

export function mysqlConnectionOptions(config: DbConnectionConfig): mysql.ConnectionOptions {
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

export function pgConnectionOptions(config: DbConnectionConfig): pg.ClientConfig {
  return {
    host: config.host || 'localhost',
    port: config.port || 5432,
    user: config.user,
    password: config.password,
    database: config.database || undefined,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: (config.connectTimeout || 10000)
  };
}

export function assertWritable(config: DbConnectionConfig): void {
  if (config.driver !== 'mysql' && config.driver !== 'postgres') {
    throw new Error('不支持的数据库类型。');
  }
  if (config.readonly) {
    throw new Error('当前连接为只读模式，已阻止写操作。');
  }
}

export async function appendHistory(
  config: DbConnectionConfig,
  sql: string,
  result: QueryResult,
  readQueryHistory: () => Promise<QueryHistoryItem[]>,
  writeQueryHistory: (history: QueryHistoryItem[]) => Promise<QueryHistoryItem[]>
): Promise<void> {
  const history = await readQueryHistory();
  await writeQueryHistory([
    {
      id: crypto.randomUUID(),
      connectionId: config.id,
      connectionName: config.name,
      database: config.database,
      sql,
      rowCount: result.rowCount,
      durationMs: result.durationMs,
      createdAt: new Date().toISOString()
    },
    ...history
  ]);
}
