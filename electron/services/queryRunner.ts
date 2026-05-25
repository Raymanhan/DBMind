import mysql from 'mysql2/promise';
import pg from 'pg';
import type {
  DatabaseInfo,
  DbConnectionConfig,
  QueryResult,
  TableSchema
} from '../../src/shared/types.js';
import { mysqlConnectionOptions } from './dbCommon.js';
import { appendQueryHistory } from './storageStore.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function quoteMysqlIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
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
      references: row.referencedTable && row.referencedColumn
        ? `${row.referencedTable}.${row.referencedColumn}`
        : undefined
    });
  }
  return [...map.values()];
}

// ── Schema ──────────────────────────────────────────────────────────────────

export async function getSchema(config: DbConnectionConfig): Promise<TableSchema[]> {
  if (config.driver === 'mysql') {
    const connection = await mysql.createConnection(mysqlConnectionOptions(config));
    try {
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
      return groupSchemaRows(rows as Record<string, string>[]);
    } finally {
      await connection.end();
    }
  }

  // PostgreSQL
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

// ── Databases ───────────────────────────────────────────────────────────────

export async function listDatabases(config: DbConnectionConfig): Promise<DatabaseInfo[]> {
  if (config.driver === 'postgres') {
    return [{ name: config.database || 'public', system: false }];
  }

  const connection = await mysql.createConnection(
    mysqlConnectionOptions({ ...config, database: undefined })
  );
  try {
    const [rows] = await connection.query('SHOW DATABASES');
    const systemDatabases = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
    return (rows as Record<string, string>[]).map((row) => {
      const name = row.Database ?? Object.values(row)[0];
      return { name, system: systemDatabases.has(name) };
    });
  } finally {
    await connection.end();
  }
}

// ── Test Connection ─────────────────────────────────────────────────────────

export async function testConnection(config: DbConnectionConfig): Promise<{ ok: boolean; message: string }> {
  try {
    if (config.driver === 'mysql') {
    const connection = await mysql.createConnection(
      mysqlConnectionOptions({ ...config, database: undefined })
    );
    try {
      await connection.ping();
    } finally {
      await connection.end();
    }
      const databases = await listDatabases(config);
      const userDatabaseCount = databases.filter((db) => !db.system).length;
      if (!config.database) {
        return {
          ok: true,
          message: `服务器连接成功，读取到 ${databases.length} 个数据库，其中 ${userDatabaseCount} 个用户数据库。请选择数据库后保存。`
        };
      }
      const schema = await getSchema(config);
      return { ok: true, message: `连接成功，当前库读取到 ${schema.length} 个对象。` };
    }

    // PostgreSQL
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

// ── Run Query ───────────────────────────────────────────────────────────────

export async function runQuery(
  config: DbConnectionConfig,
  sql: string,
  database?: string
): Promise<QueryResult> {
  const targetDb = database || config.database;
  const resolvedConfig = targetDb ? { ...config, database: targetDb } : config;
  const started = performance.now();

  if (config.driver === 'mysql') {
    if (config.readonly && !/^\s*(select|show|describe|desc|explain)\b/i.test(sql)) {
      throw new Error('当前连接为只读模式，已阻止写操作。');
    }
    const connection = await mysql.createConnection(mysqlConnectionOptions(resolvedConfig));
    try {
      const [rows, fields] = await connection.query(sql);
      const records = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
      const result: QueryResult = {
        columns: fields?.map((field) => field.name) ?? Object.keys(records[0] ?? {}),
        rows: records,
        rowCount: records.length,
        durationMs: Math.round(performance.now() - started)
      };
      await appendQueryHistory(resolvedConfig, sql, result);
      return result;
    } finally {
      await connection.end();
    }
  }

  // PostgreSQL
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
  const queryResult: QueryResult = {
    columns: result.fields.map((field) => field.name),
    rows: result.rows,
    rowCount: result.rowCount ?? result.rows.length,
    durationMs: Math.round(performance.now() - started)
  };
  await appendQueryHistory(resolvedConfig, sql, queryResult);
  return queryResult;
}

// ── Table DDL ───────────────────────────────────────────────────────────────

export async function getTableDdl(config: DbConnectionConfig, tableName: string): Promise<string> {
  if (config.driver !== 'mysql') {
    throw new Error('当前仅 MySQL 支持读取建表 DDL。');
  }
  const connection = await mysql.createConnection(mysqlConnectionOptions(config));
  try {
    const [rows] = await connection.query(
      `SHOW CREATE TABLE ${quoteMysqlIdentifier(tableName)}`
    );
    const record = (rows as Record<string, string>[])[0];
    return record?.['Create Table'] ?? record?.['Create View'] ?? '';
  } finally {
    await connection.end();
  }
}
