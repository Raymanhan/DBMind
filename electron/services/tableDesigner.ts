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
const MYSQL_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(?:\s*\([0-9,\s]+\))?(?:\s+(?:unsigned|signed|zerofill))*$/i;
const MYSQL_NAME_PATTERN = /^[a-zA-Z0-9_$]+$/;
const MYSQL_OPTION_PATTERN = /^[a-zA-Z0-9_]+$/;
const FK_ACTIONS = new Set(['', 'RESTRICT', 'CASCADE', 'SET NULL', 'NO ACTION']);

function sqlString(value?: string | null): string {
  if (value === undefined || value === null || value === '') return '';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertMysqlIdentifier(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label}不能为空。`);
  if (!MYSQL_NAME_PATTERN.test(value)) {
    throw new Error(`${label}只能包含字母、数字、下划线、$。`);
  }
}

function assertMysqlOption(value: string, label: string): void {
  if (!value.trim()) return;
  if (!MYSQL_OPTION_PATTERN.test(value)) {
    throw new Error(`${label}格式不合法。`);
  }
}

function assertColumnType(value: string): void {
  if (!MYSQL_TYPE_PATTERN.test(value.trim())) {
    throw new Error(`字段类型不合法：${value}`);
  }
}

function assertForeignKeyAction(value: string | undefined, label: string): void {
  const normalized = value ?? '';
  if (!FK_ACTIONS.has(normalized)) throw new Error(`${label}不合法：${normalized}`);
}

function columnDefinition(column: TableDesignColumn): string {
  assertMysqlIdentifier(column.name, '字段名');
  assertColumnType(column.type || 'varchar(255)');
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
  assertMysqlIdentifier(index.name, '索引名');
  if (!index.columns.length) throw new Error(`索引 ${index.name} 缺少字段。`);
  index.columns.forEach((column) => assertMysqlIdentifier(column, `索引 ${index.name} 的字段名`));
  const unique = index.unique ? 'UNIQUE ' : '';
  const columns = index.columns.map(quoteMysqlIdentifier).join(', ');
  return `ADD ${unique}INDEX ${quoteMysqlIdentifier(index.name)} (${columns})`;
}

function foreignKeySql(fk: TableDesignForeignKey): string {
  assertMysqlIdentifier(fk.name, '外键名');
  if (!fk.columns.length || !fk.referencedColumns.length) throw new Error(`外键 ${fk.name} 缺少字段。`);
  assertMysqlIdentifier(fk.referencedTable, `外键 ${fk.name} 的引用表`);
  fk.columns.forEach((column) => assertMysqlIdentifier(column, `外键 ${fk.name} 的本表字段`));
  fk.referencedColumns.forEach((column) => assertMysqlIdentifier(column, `外键 ${fk.name} 的引用字段`));
  assertForeignKeyAction(fk.onUpdate, 'ON UPDATE');
  assertForeignKeyAction(fk.onDelete, 'ON DELETE');
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
  assertMysqlIdentifier(original.database, '数据库名');
  assertMysqlIdentifier(original.table, '表名');
  if (draft.table !== original.table || draft.database !== original.database) {
    throw new Error('暂不支持在表设计器中修改数据库名或表名。');
  }
  assertMysqlOption(draft.engine ?? '', 'Engine');
  assertMysqlOption(draft.collation ?? '', 'Collation');
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
  const generatedSql = previewTableDesign(change);
  if (sql.trim() && sql.trim() !== generatedSql.trim()) {
    throw new Error('表结构 SQL 已过期或被修改，请重新生成 ALTER 后再执行。');
  }
  if (!generatedSql.trim()) return { ok: true, sql: generatedSql, message: '没有需要执行的结构变更。' };
  const connection = await mysql.createConnection(mysqlConnectionOptions({ ...config, database: change.original.database }));
  try {
    await connection.query(generatedSql);
    return { ok: true, sql: generatedSql };
  } finally {
    await connection.end();
  }
}
