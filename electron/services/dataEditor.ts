import mysql from 'mysql2/promise';
import type { BatchUpdateCellRequest, BatchUpdateCellResponse, DbConnectionConfig, UpdateCellRequest, UpdateCellResponse } from '../../src/shared/types.js';
import { mysqlTableRef, quoteMysqlIdentifier } from '../../src/shared/sql/identifiers.js';
import { assertWritableMysql, mysqlConnectionOptions } from './dbCommon.js';

export function buildUpdateCellSql(request: UpdateCellRequest): { sql: string; params: unknown[] } {
  const pkEntries = Object.entries(request.primaryKey);
  if (!pkEntries.length) throw new Error('缺少主键信息，无法安全更新单元格。');
  const where = pkEntries.map(([column]) => `${quoteMysqlIdentifier(column)} = ?`).join(' AND ');
  return {
    sql: `UPDATE ${mysqlTableRef(request.table, request.database)} SET ${quoteMysqlIdentifier(request.column)} = ? WHERE ${where};`,
    params: [request.value, ...pkEntries.map(([, value]) => value)]
  };
}

export async function updateCell(config: DbConnectionConfig, request: UpdateCellRequest): Promise<UpdateCellResponse> {
  assertWritableMysql(config);
  const { sql, params } = buildUpdateCellSql(request);
  if (!request.execute) return { sql, ok: false, message: 'preview' };

  const connection = await mysql.createConnection(mysqlConnectionOptions({ ...config, database: request.database }));
  try {
    const [result] = await connection.execute(sql, params as mysql.ExecuteValues);
    const affectedRows = 'affectedRows' in (result as mysql.ResultSetHeader) ? (result as mysql.ResultSetHeader).affectedRows : 0;
    return { sql, ok: true, affectedRows };
  } finally {
    await connection.end();
  }
}

export function buildBatchUpdateSql(request: BatchUpdateCellRequest): { sql: string; params: unknown[] }[] {
  return request.edits.map((edit) =>
    buildUpdateCellSql({
      connectionId: request.connectionId,
      database: request.database,
      table: request.table,
      column: edit.column,
      primaryKey: edit.primaryKey,
      value: edit.value
    })
  );
}

export async function updateCellsBatch(config: DbConnectionConfig, request: BatchUpdateCellRequest): Promise<BatchUpdateCellResponse> {
  assertWritableMysql(config);
  const entries = buildBatchUpdateSql(request);
  const sqls = entries.map((e) => e.sql);

  if (!request.execute) return { sqls, ok: false };

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
