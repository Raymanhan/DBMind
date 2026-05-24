import mysql from 'mysql2/promise';
import type {
  DbConnectionConfig,
  TableDesign,
  TableDesignApplyResponse,
  TableDesignChange,
  TableDesignColumn,
  TableDesignForeignKey,
  TableDesignIndex
} from '../../src/shared/types.js';
import { mysqlTableRef, quoteMysqlIdentifier } from '../../src/shared/sql/identifiers.js';
import { assertWritableMysql, mysqlConnectionOptions } from './dbCommon.js';

type Row = Record<string, string | number | null>;

function sqlString(value?: string | null): string {
  if (value === undefined || value === null || value === '') return '';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function columnDefinition(column: TableDesignColumn): string {
  const parts = [
    quoteMysqlIdentifier(column.name),
    column.type || 'varchar(255)',
    column.nullable ? 'NULL' : 'NOT NULL'
  ];
  if (column.defaultValue !== undefined && column.defaultValue !== null && column.defaultValue !== '') {
    parts.push(`DEFAULT ${sqlString(column.defaultValue)}`);
  }
  if (column.autoIncrement) parts.push('AUTO_INCREMENT');
  if (column.comment) parts.push(`COMMENT ${sqlString(column.comment)}`);
  return parts.join(' ');
}

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameColumn(a: TableDesignColumn, b: TableDesignColumn): boolean {
  return a.name === b.name && a.type === b.type && a.nullable === b.nullable && Boolean(a.autoIncrement) === Boolean(b.autoIncrement) &&
    (a.defaultValue ?? '') === (b.defaultValue ?? '') && (a.comment ?? '') === (b.comment ?? '') && a.primary === b.primary && Boolean(a.dropped) === Boolean(b.dropped);
}

function indexSql(index: TableDesignIndex): string {
  const unique = index.unique ? 'UNIQUE ' : '';
  const columns = index.columns.map(quoteMysqlIdentifier).join(', ');
  return `ADD ${unique}INDEX ${quoteMysqlIdentifier(index.name)} (${columns})`;
}

function foreignKeySql(fk: TableDesignForeignKey): string {
  const columns = fk.columns.map(quoteMysqlIdentifier).join(', ');
  const refColumns = fk.referencedColumns.map(quoteMysqlIdentifier).join(', ');
  const onUpdate = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '';
  const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '';
  return `ADD CONSTRAINT ${quoteMysqlIdentifier(fk.name)} FOREIGN KEY (${columns}) REFERENCES ${quoteMysqlIdentifier(fk.referencedTable)} (${refColumns})${onUpdate}${onDelete}`;
}

export async function getTableDesign(config: DbConnectionConfig, database: string, table: string): Promise<TableDesign> {
  if (config.driver !== 'mysql') throw new Error('当前仅 MySQL 支持表设计器。');
  const connection = await mysql.createConnection(mysqlConnectionOptions({ ...config, database }));
  try {
    const [tableRows] = await connection.query(
      `SELECT TABLE_COMMENT tableComment, ENGINE engine, TABLE_COLLATION collation
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [database, table]
    );
    const tableInfo = (tableRows as Row[])[0] ?? {};

    const [columnRows] = await connection.query(
      `SELECT COLUMN_NAME name, COLUMN_TYPE type, IS_NULLABLE nullable, COLUMN_KEY columnKey,
              COLUMN_DEFAULT defaultValue, COLUMN_COMMENT comment, EXTRA extra
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [database, table]
    );

    const [indexRows] = await connection.query(`SHOW INDEX FROM ${mysqlTableRef(table, database)}`);
    const indexMap = new Map<string, TableDesignIndex>();
    for (const row of indexRows as Row[]) {
      const name = String(row.Key_name);
      if (name === 'PRIMARY') continue;
      const existing = indexMap.get(name) ?? { name, originalName: name, unique: Number(row.Non_unique) === 0, columns: [] };
      existing.columns.push(String(row.Column_name));
      indexMap.set(name, existing);
    }

    const [fkRows] = await connection.query(
      `SELECT rc.CONSTRAINT_NAME name, kcu.COLUMN_NAME columnName, kcu.REFERENCED_TABLE_NAME referencedTable,
              kcu.REFERENCED_COLUMN_NAME referencedColumn, rc.UPDATE_RULE onUpdate, rc.DELETE_RULE onDelete
       FROM information_schema.KEY_COLUMN_USAGE kcu
       JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
         ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      [database, table]
    );
    const fkMap = new Map<string, TableDesignForeignKey>();
    for (const row of fkRows as Row[]) {
      const name = String(row.name);
      const existing = fkMap.get(name) ?? {
        name,
        originalName: name,
        columns: [],
        referencedTable: String(row.referencedTable),
        referencedColumns: [],
        onUpdate: String(row.onUpdate ?? ''),
        onDelete: String(row.onDelete ?? '')
      };
      existing.columns.push(String(row.columnName));
      existing.referencedColumns.push(String(row.referencedColumn));
      fkMap.set(name, existing);
    }

    return {
      database,
      table,
      engine: String(tableInfo.engine ?? ''),
      collation: String(tableInfo.collation ?? ''),
      comment: String(tableInfo.tableComment ?? ''),
      columns: (columnRows as Row[]).map((row) => ({
        name: String(row.name),
        originalName: String(row.name),
        type: String(row.type),
        nullable: row.nullable === 'YES',
        primary: row.columnKey === 'PRI',
        autoIncrement: String(row.extra ?? '').includes('auto_increment'),
        defaultValue: row.defaultValue === null ? null : String(row.defaultValue ?? ''),
        comment: String(row.comment ?? '')
      })),
      indexes: [...indexMap.values()],
      foreignKeys: [...fkMap.values()]
    };
  } finally {
    await connection.end();
  }
}

export function previewTableDesign(change: TableDesignChange): string {
  const { original, draft } = change;
  const tableRef = mysqlTableRef(original.table, original.database);
  const clauses: string[] = [];

  for (const column of draft.columns) {
    const originalColumn = original.columns.find((item) => item.originalName === column.originalName || item.name === column.originalName);
    if (column.dropped && originalColumn) clauses.push(`DROP COLUMN ${quoteMysqlIdentifier(originalColumn.name)}`);
    else if (!originalColumn) clauses.push(`ADD COLUMN ${columnDefinition(column)}`);
    else if (!sameColumn(originalColumn, column)) clauses.push(`CHANGE COLUMN ${quoteMysqlIdentifier(originalColumn.name)} ${columnDefinition(column)}`);
  }

  const originalPk = original.columns.filter((column) => column.primary).map((column) => column.name);
  const draftPk = draft.columns.filter((column) => column.primary && !column.dropped).map((column) => column.name);
  if (!sameArray(originalPk, draftPk)) {
    if (originalPk.length) clauses.push('DROP PRIMARY KEY');
    if (draftPk.length) clauses.push(`ADD PRIMARY KEY (${draftPk.map(quoteMysqlIdentifier).join(', ')})`);
  }

  for (const index of draft.indexes) {
    const originalIndex = original.indexes.find((item) => item.originalName === index.originalName || item.name === index.originalName);
    if (index.dropped && originalIndex) clauses.push(`DROP INDEX ${quoteMysqlIdentifier(originalIndex.name)}`);
    else if (!originalIndex) clauses.push(indexSql(index));
    else if (originalIndex.name !== index.name || Boolean(originalIndex.unique) !== Boolean(index.unique) || !sameArray(originalIndex.columns, index.columns)) {
      clauses.push(`DROP INDEX ${quoteMysqlIdentifier(originalIndex.name)}`);
      clauses.push(indexSql(index));
    }
  }

  for (const fk of draft.foreignKeys) {
    const originalFk = original.foreignKeys.find((item) => item.originalName === fk.originalName || item.name === fk.originalName);
    if (fk.dropped && originalFk) clauses.push(`DROP FOREIGN KEY ${quoteMysqlIdentifier(originalFk.name)}`);
    else if (!originalFk) clauses.push(foreignKeySql(fk));
    else if (
      originalFk.name !== fk.name ||
      originalFk.referencedTable !== fk.referencedTable ||
      !sameArray(originalFk.columns, fk.columns) ||
      !sameArray(originalFk.referencedColumns, fk.referencedColumns) ||
      (originalFk.onUpdate ?? '') !== (fk.onUpdate ?? '') ||
      (originalFk.onDelete ?? '') !== (fk.onDelete ?? '')
    ) {
      clauses.push(`DROP FOREIGN KEY ${quoteMysqlIdentifier(originalFk.name)}`);
      clauses.push(foreignKeySql(fk));
    }
  }

  if ((original.comment ?? '') !== (draft.comment ?? '')) clauses.push(`COMMENT = ${sqlString(draft.comment ?? '')}`);
  if ((original.engine ?? '') !== (draft.engine ?? '') && draft.engine) clauses.push(`ENGINE = ${draft.engine}`);
  if ((original.collation ?? '') !== (draft.collation ?? '') && draft.collation) clauses.push(`COLLATE = ${draft.collation}`);

  return clauses.length ? `ALTER TABLE ${tableRef}\n  ${clauses.join(',\n  ')};` : '';
}

export async function applyTableDesign(config: DbConnectionConfig, change: TableDesignChange, sql: string): Promise<TableDesignApplyResponse> {
  assertWritableMysql(config);
  if (!sql.trim()) return { ok: true, sql, message: '没有需要执行的结构变更。' };
  const connection = await mysql.createConnection(mysqlConnectionOptions({ ...config, database: change.original.database }));
  try {
    await connection.query(sql);
    return { ok: true, sql };
  } finally {
    await connection.end();
  }
}
