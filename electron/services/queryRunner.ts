import mysql from 'mysql2/promise';
import pg from 'pg';
import type {
  DatabaseInfo,
  DbConnectionConfig,
  QueryResult,
  TableSchema
} from '../../src/shared/types.js';
import { mysqlConnectionOptions, pgConnectionOptions } from './dbCommon.js';
import { appendQueryHistory } from './storageStore.js';
import { quotePgIdentifier } from '../../src/shared/sql/identifiers.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function toIpcSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Buffer) return value.toString('base64');
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(toIpcSafe);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toIpcSafe(val);
    }
    return result;
  }
  return value;
}

function sanitizeRows(records: Record<string, unknown>[]): Record<string, unknown>[] {
  // Fast path: check if any row has problematic values before deep sanitizing
  let needsSanitize = false;
  for (const row of records) {
    for (const val of Object.values(row)) {
      if (val instanceof Buffer || typeof val === 'bigint' || val instanceof Date) {
        needsSanitize = true;
        break;
      }
    }
    if (needsSanitize) break;
  }
  if (!needsSanitize) return records;
  return records.map((row) => toIpcSafe(row) as Record<string, unknown>);
}

function pgColumnType(dataType: string, charMaxLen: number, numPrecision: number, numScale: number): string {
  const dt = dataType.toLowerCase();
  if (dt === 'character varying' && charMaxLen) return `varchar(${charMaxLen})`;
  if (dt === 'character' && charMaxLen) return `char(${charMaxLen})`;
  if (dt === 'numeric' && numPrecision) {
    return numScale ? `numeric(${numPrecision},${numScale})` : `numeric(${numPrecision})`;
  }
  if (dt === 'timestamp without time zone') return 'timestamp';
  if (dt === 'timestamp with time zone') return 'timestamptz';
  if (dt === 'time without time zone') return 'time';
  if (dt === 'time with time zone') return 'timetz';
  return dataType;
}

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
  const client = new pg.Client(pgConnectionOptions(config));
  await client.connect();
  try {
    const schemaParam = config.database || 'public';

    const [schemaResult, fkResult] = await Promise.all([
      client.query(
        `SELECT
           t.table_name AS "tableName",
           t.table_type AS "tableType",
           c.column_name AS "columnName",
           c.data_type AS "dataType",
           c.character_maximum_length::int AS "charMaxLen",
           c.numeric_precision::int AS "numPrecision",
           c.numeric_scale::int AS "numScale",
           c.is_nullable AS "nullable",
           c.column_default AS "columnDefault",
           CASE WHEN pk.column_name IS NOT NULL THEN 'PRI' ELSE '' END AS "columnKey",
           pg_catalog.col_description(pgc.oid, c.ordinal_position) AS "columnComment",
           pg_catalog.obj_description(pgc.oid, 'pg_class') AS "tableComment",
           COALESCE(s.n_live_tup, 0)::bigint AS "tableRows"
         FROM information_schema.tables t
         JOIN information_schema.columns c
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         JOIN pg_catalog.pg_class pgc
           ON pgc.relname = t.table_name
         JOIN pg_catalog.pg_namespace pgn
           ON pgn.oid = pgc.relnamespace AND pgn.nspname = t.table_schema
         LEFT JOIN pg_catalog.pg_stat_user_tables s
           ON s.schemaname = t.table_schema AND s.relname = t.table_name
         LEFT JOIN information_schema.table_constraints tc
           ON tc.table_schema = t.table_schema AND tc.table_name = t.table_name
          AND tc.constraint_type = 'PRIMARY KEY'
         LEFT JOIN information_schema.key_column_usage pk
           ON pk.table_schema = tc.table_schema AND pk.table_name = tc.table_name
          AND pk.constraint_name = tc.constraint_name AND pk.column_name = c.column_name
         WHERE t.table_schema = $1
         ORDER BY t.table_name, c.ordinal_position`,
        [schemaParam]
      ),
      client.query(
        `SELECT
           kcu.table_name AS "tableName",
           kcu.column_name AS "columnName",
           ccu.table_name AS "referencedTable",
           ccu.column_name AS "referencedColumn"
         FROM information_schema.key_column_usage kcu
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_schema = kcu.constraint_schema
          AND rc.constraint_name = kcu.constraint_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_schema = rc.constraint_schema
          AND ccu.constraint_name = rc.constraint_name
         WHERE kcu.table_schema = $1`,
        [schemaParam]
      )
    ]);

    type PgSchemaRow = Record<string, unknown>;
    const schemaRows = (schemaResult.rows as PgSchemaRow[]).map((row) => ({
      ...row,
      tableName: String(row.tableName ?? ''),
      tableType: String(row.tableType ?? ''),
      columnName: String(row.columnName ?? ''),
      columnType: pgColumnType(
        String(row.dataType ?? ''),
        Number(row.charMaxLen ?? 0),
        Number(row.numPrecision ?? 0),
        Number(row.numScale ?? 0)
      ),
      columnKey: String(row.columnKey ?? ''),
      columnDefault: row.columnDefault,
      columnComment: row.columnComment,
      tableComment: row.tableComment,
      tableRows: row.tableRows,
      nullable: String(row.nullable ?? ''),
      extra: row.columnDefault && String(row.columnDefault ?? '').includes('nextval') ? 'auto_increment' : '',
      engine: '',
      collation: '',
      referencedTable: null as string | null,
      referencedColumn: null as string | null
    }));

    // Merge FK references
    const fkMap = new Map<string, { table: string; column: string }>();
    for (const fkRow of fkResult.rows as Record<string, string>[]) {
      fkMap.set(`${fkRow.tableName}.${fkRow.columnName}`, {
        table: fkRow.referencedTable,
        column: fkRow.referencedColumn
      });
    }
    for (const row of schemaRows) {
      const fk = fkMap.get(`${row.tableName}.${row.columnName}`);
      if (fk) {
        row.referencedTable = fk.table;
        row.referencedColumn = fk.column;
      }
    }

    return groupSchemaRows(schemaRows as unknown as Record<string, string>[]);
  } finally {
    await client.end();
  }
}

// ── Databases ───────────────────────────────────────────────────────────────

export async function listDatabases(config: DbConnectionConfig): Promise<DatabaseInfo[]> {
  if (config.driver === 'postgres') {
    const client = new pg.Client(pgConnectionOptions(config));
    try {
      await client.connect();
      const result = await client.query(
        `SELECT schema_name AS name FROM information_schema.schemata
         WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
         ORDER BY schema_name`
      );
      return (result.rows as Record<string, string>[]).map((row) => ({
        name: row.name,
        system: row.name === 'pg_catalog' || row.name === 'information_schema'
      }));
    } finally {
      await client.end();
    }
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
    const client = new pg.Client(pgConnectionOptions(config));
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
      const records = sanitizeRows(Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []);
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
  if (config.readonly && !/^\s*(select|show|describe|desc|explain|with)\b/i.test(sql)) {
    throw new Error('当前连接为只读模式，已阻止写操作。');
  }
  const client = new pg.Client(pgConnectionOptions(resolvedConfig));
  await client.connect();
  const pgResult = await client.query(sql);
  await client.end();
  const pgRows = sanitizeRows(pgResult.rows as Record<string, unknown>[]);
  const queryResult: QueryResult = {
    columns: pgResult.fields.map((field) => field.name),
    rows: pgRows,
    rowCount: pgResult.rowCount ?? pgRows.length,
    durationMs: Math.round(performance.now() - started)
  };
  await appendQueryHistory(resolvedConfig, sql, queryResult);
  return queryResult;
}

// ── Table DDL ───────────────────────────────────────────────────────────────

export async function getTableDdl(config: DbConnectionConfig, tableName: string): Promise<string> {
  if (config.driver === 'postgres') {
    const client = new pg.Client(pgConnectionOptions(config));
    try {
      await client.connect();
      const schema = config.database || 'public';

      const colResult = await client.query(
        `SELECT c.column_name, c.data_type, c.character_maximum_length AS "charMaxLen",
                c.numeric_precision AS "numPrecision", c.numeric_scale AS "numScale",
                c.is_nullable, c.column_default,
                pg_catalog.col_description(pgc.oid, c.ordinal_position) AS comment
         FROM information_schema.columns c
         JOIN pg_catalog.pg_class pgc ON pgc.relname = $2
         JOIN pg_catalog.pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = $1
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        [schema, tableName]
      );

      const pkResult = await client.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_schema = kcu.constraint_schema
          AND tc.constraint_name = kcu.constraint_name
         WHERE tc.constraint_type = 'PRIMARY KEY'
           AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, tableName]
      );
      const pkColumns = new Set((pkResult.rows as Record<string, string>[]).map(r => r.column_name));

      const lines: string[] = [];
      for (const col of colResult.rows as Record<string, unknown>[]) {
        const name = String(col.column_name ?? '');
        const type = pgColumnType(
          String(col.data_type ?? ''),
          Number(col.charMaxLen ?? 0),
          Number(col.numPrecision ?? 0),
          Number(col.numScale ?? 0)
        );
        const nullable = col.is_nullable === 'YES' ? '' : ' NOT NULL';
        const defVal = col.column_default ? ` DEFAULT ${String(col.column_default)}` : '';
        const comment = col.comment ? ` -- ${String(col.comment)}` : '';
        lines.push(`  ${quotePgIdentifier(name)} ${type}${nullable}${defVal},${comment}`);
      }
      if (pkColumns.size > 0) {
        const pkList = [...pkColumns].map(quotePgIdentifier).join(', ');
        lines.push(`  PRIMARY KEY (${pkList})`);
      }

      const commentResult = await client.query(
        `SELECT pg_catalog.obj_description(pgc.oid, 'pg_class') AS comment
         FROM pg_catalog.pg_class pgc
         JOIN pg_catalog.pg_namespace pgn ON pgn.oid = pgc.relnamespace
         WHERE pgc.relname = $1 AND pgn.nspname = $2`,
        [tableName, schema]
      );
      const tableComment = String((commentResult.rows[0] as Record<string, unknown> ?? {}).comment ?? '');

      let ddl = `CREATE TABLE ${quotePgIdentifier(schema)}.${quotePgIdentifier(tableName)} (\n${lines.join('\n')}\n);`;
      if (tableComment && tableComment !== 'null') {
        ddl += `\n\nCOMMENT ON TABLE ${quotePgIdentifier(schema)}.${quotePgIdentifier(tableName)} IS '${tableComment.replace(/'/g, "''")}';`;
      }
      return ddl;
    } finally {
      await client.end();
    }
  }

  // MySQL
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
