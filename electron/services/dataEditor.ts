import mysql from 'mysql2/promise';
import type { DbConnectionConfig, UpdateCellRequest, UpdateCellResponse } from '../../src/shared/types.js';
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
