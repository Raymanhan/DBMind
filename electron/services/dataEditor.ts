import mysql from 'mysql2/promise';
import pg from 'pg';
import type { BatchUpdateCellRequest, BatchUpdateCellResponse, DbConnectionConfig, UpdateCellRequest, UpdateCellResponse } from '../../src/shared/types.js';
import { mysqlTableRef, quoteMysqlIdentifier, pgTableRef, quotePgIdentifier } from '../../src/shared/sql/identifiers.js';
import { assertWritable, mysqlConnectionOptions, pgConnectionOptions } from './dbCommon.js';

function mysqlParamSql(column: string, table: string, database: string, pkColumns: string[]): string {
  const set = `${quoteMysqlIdentifier(column)} = ?`;
  const where = pkColumns.map((c) => `${quoteMysqlIdentifier(c)} = ?`).join(' AND ');
  return `UPDATE ${mysqlTableRef(table, database)} SET ${set} WHERE ${where};`;
}

function pgParamSql(column: string, table: string, schema: string, pkColumns: string[]): string {
  const set = `${quotePgIdentifier(column)} = $1`;
  const where = pkColumns.map((c, i) => `${quotePgIdentifier(c)} = $${i + 2}`).join(' AND ');
  return `UPDATE ${pgTableRef(table, schema)} SET ${set} WHERE ${where};`;
}

export function buildUpdateCellSql(request: UpdateCellRequest): { sql: string; params: unknown[]; driver: string } {
  const pkEntries = Object.entries(request.primaryKey);
  if (!pkEntries.length) throw new Error('缺少主键信息，无法安全更新单元格。');
  const pkColumns = pkEntries.map(([col]) => col);
  const pkValues = pkEntries.map(([, val]) => val);

  return {
    sql: mysqlParamSql(request.column, request.table, request.database, pkColumns),
    params: [request.value, ...pkValues],
    driver: 'mysql'
  };
}

export async function updateCell(config: DbConnectionConfig, request: UpdateCellRequest): Promise<UpdateCellResponse> {
  assertWritable(config);
  const { sql, params } = buildUpdateCellSql(request);
  if (!request.execute) return { sql, ok: false, message: 'preview' };

  if (config.driver === 'postgres') {
    return updateCellPg(config, request, sql, params);
  }

  const connection = await mysql.createConnection(mysqlConnectionOptions({ ...config, database: request.database }));
  try {
    const [result] = await connection.execute(sql, params as mysql.ExecuteValues);
    const affectedRows = 'affectedRows' in (result as mysql.ResultSetHeader) ? (result as mysql.ResultSetHeader).affectedRows : 0;
    return { sql, ok: true, affectedRows };
  } finally {
    await connection.end();
  }
}

async function updateCellPg(
  config: DbConnectionConfig,
  request: UpdateCellRequest,
  _mysqlSql: string,
  _mysqlParams: unknown[]
): Promise<UpdateCellResponse> {
  const pkEntries = Object.entries(request.primaryKey);
  const pkColumns = pkEntries.map(([col]) => col);
  const schema = request.database || config.database || 'public';
  const pgSql = pgParamSql(request.column, request.table, schema, pkColumns);
  const client = new pg.Client(pgConnectionOptions({ ...config, database: schema }));
  try {
    await client.connect();
    const result = await client.query(pgSql, [request.value, ...pkEntries.map(([, v]) => v)]);
    return { sql: pgSql, ok: true, affectedRows: result.rowCount ?? 0 };
  } finally {
    await client.end();
  }
}

export function buildBatchUpdateSql(request: BatchUpdateCellRequest): { sql: string; params: unknown[]; driver: string }[] {
  return request.edits.map((edit) => {
    const entry = buildUpdateCellSql({
      connectionId: request.connectionId,
      database: request.database,
      table: request.table,
      column: edit.column,
      primaryKey: edit.primaryKey,
      value: edit.value
    });
    return { ...entry, sql: entry.sql, params: entry.params, driver: entry.driver };
  });
}

export async function updateCellsBatch(config: DbConnectionConfig, request: BatchUpdateCellRequest): Promise<BatchUpdateCellResponse> {
  assertWritable(config);
  const entries = buildBatchUpdateSql(request);
  const sqls = entries.map((e) => e.sql);

  if (!request.execute) return { sqls, ok: false };

  if (config.driver === 'postgres') {
    const schema = request.database || config.database || 'public';
    const client = new pg.Client(pgConnectionOptions({ ...config, database: schema }));
    try {
      await client.connect();
      await client.query('BEGIN');
      let totalAffected = 0;
      for (const edit of request.edits) {
        const pkEntries = Object.entries(edit.primaryKey);
        const pkColumns = pkEntries.map(([col]) => col);
        const pgSql = pgParamSql(edit.column, request.table, schema, pkColumns);
        const result = await client.query(pgSql, [edit.value, ...pkEntries.map(([, v]) => v)]);
        totalAffected += result.rowCount ?? 0;
      }
      await client.query('COMMIT');
      return { sqls, ok: true, affectedRows: totalAffected };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      await client.end();
    }
  }

  const connection = await mysql.createConnection(mysqlConnectionOptions({ ...config, database: request.database }));
  try {
    await connection.beginTransaction();
    let totalAffected = 0;
    for (const entry of entries) {
      const [result] = await connection.execute(entry.sql, entry.params as mysql.ExecuteValues);
      totalAffected += 'affectedRows' in (result as mysql.ResultSetHeader) ? (result as mysql.ResultSetHeader).affectedRows : 0;
    }
    await connection.commit();
    return { sqls, ok: true, affectedRows: totalAffected };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}
