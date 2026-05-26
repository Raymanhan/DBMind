import mysql from 'mysql2/promise';
import pg from 'pg';
import type {
  DbConnectionConfig,
  TableDesign,
  TableDesignApplyResponse,
  TableDesignChange,
  TableDesignColumn,
  TableDesignForeignKey,
  TableDesignIndex
} from '../../src/shared/types.js';
import { mysqlTableRef, quoteMysqlIdentifier, pgTableRef, quotePgIdentifier } from '../../src/shared/sql/identifiers.js';
import { assertWritable, mysqlConnectionOptions, pgConnectionOptions } from './dbCommon.js';

type Row = Record<string, string | number | null>;

// ── MySQL helpers ─────────────────────────────────────────────────────────────

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

function assertColumnTypeMysql(value: string): void {
  if (!MYSQL_TYPE_PATTERN.test(value.trim())) {
    throw new Error(`字段类型不合法：${value}`);
  }
}

function assertForeignKeyAction(value: string | undefined, label: string): void {
  const normalized = value ?? '';
  if (!FK_ACTIONS.has(normalized)) throw new Error(`${label}不合法：${normalized}`);
}

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

// ── MySQL column/DDL ──────────────────────────────────────────────────────────

function mysqlColumnDefinition(column: TableDesignColumn): string {
  assertMysqlIdentifier(column.name, '字段名');
  assertColumnTypeMysql(column.type || 'varchar(255)');
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

function sameColumn(a: TableDesignColumn, b: TableDesignColumn): boolean {
  return a.name === b.name && a.type === b.type && a.nullable === b.nullable && Boolean(a.autoIncrement) === Boolean(b.autoIncrement) &&
    (a.defaultValue ?? '') === (b.defaultValue ?? '') && (a.comment ?? '') === (b.comment ?? '') && a.primary === b.primary && Boolean(a.dropped) === Boolean(b.dropped);
}

function mysqlIndexSql(index: TableDesignIndex): string {
  assertMysqlIdentifier(index.name, '索引名');
  if (!index.columns.length) throw new Error(`索引 ${index.name} 缺少字段。`);
  index.columns.forEach((c) => assertMysqlIdentifier(c, `索引 ${index.name} 的字段名`));
  const unique = index.unique ? 'UNIQUE ' : '';
  const columns = index.columns.map(quoteMysqlIdentifier).join(', ');
  return `ADD ${unique}INDEX ${quoteMysqlIdentifier(index.name)} (${columns})`;
}

function mysqlFkSql(fk: TableDesignForeignKey): string {
  assertMysqlIdentifier(fk.name, '外键名');
  if (!fk.columns.length || !fk.referencedColumns.length) throw new Error(`外键 ${fk.name} 缺少字段。`);
  assertMysqlIdentifier(fk.referencedTable, `外键 ${fk.name} 的引用表`);
  fk.columns.forEach((c) => assertMysqlIdentifier(c, `外键 ${fk.name} 的本表字段`));
  fk.referencedColumns.forEach((c) => assertMysqlIdentifier(c, `外键 ${fk.name} 的引用字段`));
  assertForeignKeyAction(fk.onUpdate, 'ON UPDATE');
  assertForeignKeyAction(fk.onDelete, 'ON DELETE');
  const columns = fk.columns.map(quoteMysqlIdentifier).join(', ');
  const refColumns = fk.referencedColumns.map(quoteMysqlIdentifier).join(', ');
  const onUpdate = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '';
  const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '';
  return `ADD CONSTRAINT ${quoteMysqlIdentifier(fk.name)} FOREIGN KEY (${columns}) REFERENCES ${quoteMysqlIdentifier(fk.referencedTable)} (${refColumns})${onUpdate}${onDelete}`;
}

// ── MySQL table design ───────────────────────────────────────────────────────

async function getTableDesignMysql(config: DbConnectionConfig, database: string, table: string): Promise<TableDesign> {
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
         ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
       WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
      [database, table]
    );
    const fkMap = new Map<string, TableDesignForeignKey>();
    for (const row of fkRows as Row[]) {
      const name = String(row.name);
      const existing = fkMap.get(name) ?? {
        name, originalName: name, columns: [], referencedTable: String(row.referencedTable), referencedColumns: [],
        onUpdate: String(row.onUpdate ?? ''), onDelete: String(row.onDelete ?? '')
      };
      existing.columns.push(String(row.columnName));
      existing.referencedColumns.push(String(row.referencedColumn));
      fkMap.set(name, existing);
    }

    return {
      database, table,
      engine: String(tableInfo.engine ?? ''), collation: String(tableInfo.collation ?? ''), comment: String(tableInfo.tableComment ?? ''),
      columns: (columnRows as Row[]).map((row) => ({
        name: String(row.name), originalName: String(row.name), type: String(row.type),
        nullable: row.nullable === 'YES', primary: row.columnKey === 'PRI',
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

function previewTableDesignMysql(change: TableDesignChange): string {
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
    const oc = original.columns.find((c) => c.originalName === column.originalName || c.name === column.originalName);
    if (column.dropped && oc) clauses.push(`DROP COLUMN ${quoteMysqlIdentifier(oc.name)}`);
    else if (!oc) clauses.push(`ADD COLUMN ${mysqlColumnDefinition(column)}`);
    else if (!sameColumn(oc, column)) clauses.push(`CHANGE COLUMN ${quoteMysqlIdentifier(oc.name)} ${mysqlColumnDefinition(column)}`);
  }

  const opk = original.columns.filter((c) => c.primary).map((c) => c.name);
  const dpk = draft.columns.filter((c) => c.primary && !c.dropped).map((c) => c.name);
  if (!sameArray(opk, dpk)) {
    if (opk.length) clauses.push('DROP PRIMARY KEY');
    if (dpk.length) clauses.push(`ADD PRIMARY KEY (${dpk.map(quoteMysqlIdentifier).join(', ')})`);
  }

  for (const idx of draft.indexes) {
    const oi = original.indexes.find((i) => i.originalName === idx.originalName || i.name === idx.originalName);
    if (idx.dropped && oi) clauses.push(`DROP INDEX ${quoteMysqlIdentifier(oi.name)}`);
    else if (!oi) clauses.push(mysqlIndexSql(idx));
    else if (oi.name !== idx.name || Boolean(oi.unique) !== Boolean(idx.unique) || !sameArray(oi.columns, idx.columns)) {
      clauses.push(`DROP INDEX ${quoteMysqlIdentifier(oi.name)}`);
      clauses.push(mysqlIndexSql(idx));
    }
  }

  for (const fk of draft.foreignKeys) {
    const ofk = original.foreignKeys.find((f) => f.originalName === fk.originalName || f.name === fk.originalName);
    if (fk.dropped && ofk) clauses.push(`DROP FOREIGN KEY ${quoteMysqlIdentifier(ofk.name)}`);
    else if (!ofk) clauses.push(mysqlFkSql(fk));
    else if (ofk.name !== fk.name || ofk.referencedTable !== fk.referencedTable || !sameArray(ofk.columns, fk.columns) ||
             !sameArray(ofk.referencedColumns, fk.referencedColumns) || (ofk.onUpdate ?? '') !== (fk.onUpdate ?? '') || (ofk.onDelete ?? '') !== (fk.onDelete ?? '')) {
      clauses.push(`DROP FOREIGN KEY ${quoteMysqlIdentifier(ofk.name)}`);
      clauses.push(mysqlFkSql(fk));
    }
  }

  if ((original.comment ?? '') !== (draft.comment ?? '')) clauses.push(`COMMENT = ${sqlString(draft.comment ?? '')}`);
  if ((original.engine ?? '') !== (draft.engine ?? '') && draft.engine) clauses.push(`ENGINE = ${draft.engine}`);
  if ((original.collation ?? '') !== (draft.collation ?? '') && draft.collation) clauses.push(`COLLATE = ${draft.collation}`);

  return clauses.length ? `ALTER TABLE ${tableRef}\n  ${clauses.join(',\n  ')};` : '';
}

// ── PG helpers ────────────────────────────────────────────────────────────────

const PG_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_$]*$/;
const PG_TYPE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\([0-9,\s]+\))?(?:\s*\[\])?$/i;

function assertPgIdentifier(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label}不能为空。`);
  if (!PG_NAME_PATTERN.test(value)) throw new Error(`${label}只能包含字母、数字、下划线、$，且不能以数字开头。`);
}

function assertPgType(value: string, label: string): void {
  if (!PG_TYPE_PATTERN.test(value.trim())) throw new Error(`${label}类型不合法：${value}`);
}

function pgColumnDef(column: TableDesignColumn): string {
  assertPgIdentifier(column.name, '字段名');
  assertPgType(column.type || 'varchar(255)', '字段类型');
  const parts = [quotePgIdentifier(column.name), column.type || 'varchar(255)'];
  if (!column.nullable) parts.push('NOT NULL');
  if (column.defaultValue !== undefined && column.defaultValue !== null && column.defaultValue !== '') {
    parts.push(`DEFAULT ${column.defaultValue}`);
  }
  return parts.join(' ');
}

function pgColumnAlterClauses(oc: TableDesignColumn, dc: TableDesignColumn): string[] {
  const clauses: string[] = [];
  const col = quotePgIdentifier(dc.name);
  if (oc.type !== dc.type) clauses.push(`ALTER COLUMN ${col} TYPE ${dc.type}`);
  if (oc.nullable !== dc.nullable) clauses.push(`ALTER COLUMN ${col} ${dc.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'}`);
  const odef = oc.defaultValue ?? '';
  const ddef = dc.defaultValue ?? '';
  if (odef !== ddef) {
    clauses.push(ddef ? `ALTER COLUMN ${col} SET DEFAULT ${ddef}` : `ALTER COLUMN ${col} DROP DEFAULT`);
  }
  return clauses;
}

function pgIndexSql(tableRef: string, index: TableDesignIndex): string {
  assertPgIdentifier(index.name, '索引名');
  if (!index.columns.length) throw new Error(`索引 ${index.name} 缺少字段。`);
  index.columns.forEach((c) => assertPgIdentifier(c, `索引 ${index.name} 的字段名`));
  const unique = index.unique ? 'UNIQUE ' : '';
  const columns = index.columns.map(quotePgIdentifier).join(', ');
  return `CREATE ${unique}INDEX ${quotePgIdentifier(index.name)} ON ${tableRef} (${columns});`;
}

function pgFkSql(tableRef: string, fk: TableDesignForeignKey): string {
  assertPgIdentifier(fk.name, '外键名');
  if (!fk.columns.length || !fk.referencedColumns.length) throw new Error(`外键 ${fk.name} 缺少字段。`);
  assertPgIdentifier(fk.referencedTable, `外键 ${fk.name} 的引用表`);
  fk.columns.forEach((c) => assertPgIdentifier(c, `外键 ${fk.name} 的本表字段`));
  fk.referencedColumns.forEach((c) => assertPgIdentifier(c, `外键 ${fk.name} 的引用字段`));
  const columns = fk.columns.map(quotePgIdentifier).join(', ');
  const refColumns = fk.referencedColumns.map(quotePgIdentifier).join(', ');
  const onUpdate = fk.onUpdate ? ` ON UPDATE ${fk.onUpdate}` : '';
  const onDelete = fk.onDelete ? ` ON DELETE ${fk.onDelete}` : '';
  return `ALTER TABLE ${tableRef} ADD CONSTRAINT ${quotePgIdentifier(fk.name)} FOREIGN KEY (${columns}) REFERENCES ${quotePgIdentifier(fk.referencedTable)} (${refColumns})${onUpdate}${onDelete};`;
}

// ── PG table design ──────────────────────────────────────────────────────────

async function getTableDesignPg(config: DbConnectionConfig, database: string, table: string): Promise<TableDesign> {
  const client = new pg.Client(pgConnectionOptions({ ...config, database }));
  try {
    await client.connect();
    const schema = database || 'public';

    const [colResult, pkResult, idxResult, fkResult, commentResult] = await Promise.all([
      client.query(
        `SELECT c.column_name AS name, c.data_type, c.character_maximum_length::int AS "charMaxLen",
                c.numeric_precision::int AS "numPrecision", c.numeric_scale::int AS "numScale",
                c.is_nullable AS nullable, c.column_default AS "defaultValue",
                pg_catalog.col_description(pgc.oid, c.ordinal_position) AS comment
         FROM information_schema.columns c
         JOIN pg_catalog.pg_class pgc ON pgc.relname = $2
         JOIN pg_catalog.pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = $1
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        [schema, table]
      ),
      client.query(
        `SELECT kcu.column_name AS name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, table]
      ),
      client.query(
        `SELECT i.relname AS name, ix.indisunique AS "unique",
                a.attname AS column_name
         FROM pg_class t
         JOIN pg_index ix ON t.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE t.relname = $1 AND n.nspname = $2 AND ix.indisprimary = false
         ORDER BY i.relname, a.attnum`,
        [table, schema]
      ),
      client.query(
        `SELECT con.conname AS name, con.confupdtype AS "onUpdate", con.confdeltype AS "onDelete",
                unnest(con.conkey) AS attnum, unnest(con.confkey) AS refattnum
         FROM pg_constraint con
         JOIN pg_class t ON t.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE con.contype = 'f' AND t.relname = $1 AND n.nspname = $2`,
        [table, schema]
      ),
      client.query(
        `SELECT pg_catalog.obj_description(pgc.oid, 'pg_class') AS comment
         FROM pg_catalog.pg_class pgc
         JOIN pg_catalog.pg_namespace pgn ON pgn.oid = pgc.relnamespace
         WHERE pgc.relname = $1 AND pgn.nspname = $2`,
        [table, schema]
      )
    ]);

    const pkSet = new Set((pkResult.rows as Row[]).map((r) => String(r.name)));

    // Build column names for FK resolution
    const colNames: string[] = [];
    for (const c of colResult.rows as Row[]) colNames.push(String(c.name));

    // Resolve FK referenced tables/columns
    const fkRefMap = new Map<string, { table: string; column: string }>();
    for (const fkRow of fkResult.rows as Row[]) {
      const attnum = Number(fkRow.attnum) - 1;
      const refattnum = Number(fkRow.refattnum) - 1;
      const colName = colNames[attnum] ?? '';
      const refName = colNames.join(','); // placeholder — need to query referenced table columns
      fkRefMap.set(`${fkRow.name}:${colName}`, { table: '', column: '' });
    }

    // Better FK query with actual referenced info
    const [fkDetailResult] = await Promise.all([
      client.query(
        `SELECT con.conname AS name, kcu.column_name AS column_name,
                ccu.table_name AS "refTable", ccu.column_name AS "refColumn",
                CASE con.confupdtype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' ELSE '' END AS "onUpdate",
                CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' ELSE '' END AS "onDelete"
         FROM pg_constraint con
         JOIN pg_class t ON t.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = con.conname AND kcu.table_schema = n.nspname AND kcu.table_name = t.relname
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = con.conname AND ccu.constraint_schema = n.nspname
         WHERE con.contype = 'f' AND t.relname = $1 AND n.nspname = $2
         ORDER BY con.conname, kcu.ordinal_position`,
        [table, schema]
      )
    ]);
    const fkMap = new Map<string, TableDesignForeignKey>();
    for (const row of fkDetailResult.rows as Row[]) {
      const name = String(row.name);
      const existing = fkMap.get(name) ?? {
        name, originalName: name, columns: [], referencedTable: String(row.refTable), referencedColumns: [],
        onUpdate: String(row.onUpdate ?? ''), onDelete: String(row.onDelete ?? '')
      };
      existing.columns.push(String(row.column_name));
      existing.referencedColumns.push(String(row.refColumn));
      fkMap.set(name, existing);
    }

    // Build column type strings
    function pgType(dataType: string, charMaxLen: number, numPrecision: number, numScale: number): string {
      const dt = dataType.toLowerCase();
      if (dt === 'character varying' && charMaxLen) return `varchar(${charMaxLen})`;
      if (dt === 'character' && charMaxLen) return `char(${charMaxLen})`;
      if (dt === 'numeric' && numPrecision) return numScale ? `numeric(${numPrecision},${numScale})` : `numeric(${numPrecision})`;
      if (dt === 'timestamp without time zone') return 'timestamp';
      if (dt === 'timestamp with time zone') return 'timestamptz';
      return dataType;
    }

    const tableComment = String((commentResult.rows[0] as Row ?? {}).comment ?? '');

    return {
      database: schema, table, engine: '', collation: '', comment: tableComment === 'null' ? '' : tableComment,
      columns: (colResult.rows as Row[]).map((row) => {
        const name = String(row.name);
        const defVal = row.defaultValue;
        const hasNextval = defVal && String(defVal).includes('nextval');
        return {
          name, originalName: name,
          type: pgType(String(row.data_type), Number(row.charMaxLen ?? 0), Number(row.numPrecision ?? 0), Number(row.numScale ?? 0)),
          nullable: row.nullable === 'YES',
          primary: pkSet.has(name),
          autoIncrement: hasNextval || undefined,
          defaultValue: (hasNextval || defVal === null) ? null : String(defVal ?? ''),
          comment: String(row.comment ?? '')
        };
      }),
      indexes: (idxResult.rows.length ? buildPgIndexes(idxResult.rows as Row[]) : []),
      foreignKeys: [...fkMap.values()]
    };
  } finally {
    await client.end();
  }
}

function buildPgIndexes(rows: Row[]): TableDesignIndex[] {
  const map = new Map<string, { name: string; unique: boolean; columns: string[] }>();
  for (const row of rows) {
    const name = String(row.name);
    const existing = map.get(name) ?? { name, unique: Boolean(row.unique), columns: [] };
    existing.columns.push(String(row.column_name));
    map.set(name, existing);
  }
  return [...map.values()].map((i) => ({ name: i.name, originalName: i.name, unique: i.unique, columns: i.columns }));
}

function previewTableDesignPg(change: TableDesignChange): string {
  const { original, draft } = change;
  assertPgIdentifier(original.database, 'Schema 名');
  assertPgIdentifier(original.table, '表名');
  if (draft.table !== original.table || draft.database !== original.database) {
    throw new Error('暂不支持在表设计器中修改 Schema 名或表名。');
  }
  const tableRef = pgTableRef(original.table, original.database);
  const statements: string[] = [];

  // Column changes
  for (const dc of draft.columns) {
    const oc = original.columns.find((c) => c.originalName === dc.originalName || c.name === dc.originalName);
    if (dc.dropped && oc) {
      statements.push(`ALTER TABLE ${tableRef} DROP COLUMN ${quotePgIdentifier(oc.name)};`);
    } else if (!oc) {
      statements.push(`ALTER TABLE ${tableRef} ADD COLUMN ${pgColumnDef(dc)};`);
      if (dc.primary) {
        statements.push(`ALTER TABLE ${tableRef} ADD PRIMARY KEY (${quotePgIdentifier(dc.name)});`);
      }
    } else if (!sameColumn(oc, dc)) {
      const clauses = pgColumnAlterClauses(oc, dc);
      if (clauses.length > 0) {
        statements.push(`ALTER TABLE ${tableRef} ${clauses.join(', ')};`);
      }
      if (oc.name !== dc.name) {
        statements.push(`ALTER TABLE ${tableRef} RENAME COLUMN ${quotePgIdentifier(oc.name)} TO ${quotePgIdentifier(dc.name)};`);
      }
    }
  }

  // Primary Key changes
  const opk = original.columns.filter((c) => c.primary).map((c) => c.name);
  const dpk = draft.columns.filter((c) => c.primary && !c.dropped).map((c) => c.name);
  if (!sameArray(opk, dpk)) {
    if (opk.length) statements.push(`ALTER TABLE ${tableRef} DROP CONSTRAINT ${quotePgIdentifier(original.table + '_pkey')};`);
    if (dpk.length) statements.push(`ALTER TABLE ${tableRef} ADD PRIMARY KEY (${dpk.map(quotePgIdentifier).join(', ')});`);
  }

  // Comment change
  if ((original.comment ?? '') !== (draft.comment ?? '')) {
    statements.push(`COMMENT ON TABLE ${tableRef} IS ${sqlString(draft.comment || '')};`);
  }

  // Index changes
  for (const idx of draft.indexes) {
    const oi = original.indexes.find((i) => i.originalName === idx.originalName || i.name === idx.originalName);
    if (idx.dropped && oi) statements.push(`DROP INDEX ${quotePgIdentifier(oi.name)};`);
    else if (!oi) statements.push(pgIndexSql(tableRef, idx));
    else if (oi.name !== idx.name || Boolean(oi.unique) !== Boolean(idx.unique) || !sameArray(oi.columns, idx.columns)) {
      statements.push(`DROP INDEX ${quotePgIdentifier(oi.name)};`);
      statements.push(pgIndexSql(tableRef, idx));
    }
  }

  // FK changes
  for (const fk of draft.foreignKeys) {
    const ofk = original.foreignKeys.find((f) => f.originalName === fk.originalName || f.name === fk.originalName);
    if (fk.dropped && ofk) statements.push(`ALTER TABLE ${tableRef} DROP CONSTRAINT ${quotePgIdentifier(ofk.name)};`);
    else if (!ofk) statements.push(pgFkSql(tableRef, fk));
    else if (ofk.name !== fk.name || ofk.referencedTable !== fk.referencedTable || !sameArray(ofk.columns, fk.columns) ||
             !sameArray(ofk.referencedColumns, fk.referencedColumns) || (ofk.onUpdate ?? '') !== (fk.onUpdate ?? '') || (ofk.onDelete ?? '') !== (fk.onDelete ?? '')) {
      statements.push(`ALTER TABLE ${tableRef} DROP CONSTRAINT ${quotePgIdentifier(ofk.name)};`);
      statements.push(pgFkSql(tableRef, fk));
    }
  }

  return statements.join('\n');
}

// ── Exported API ─────────────────────────────────────────────────────────────

export async function getTableDesign(config: DbConnectionConfig, database: string, table: string): Promise<TableDesign> {
  if (config.driver === 'postgres') return getTableDesignPg(config, database, table);
  if (config.driver !== 'mysql') throw new Error('当前仅 MySQL 和 PostgreSQL 支持表设计器。');
  return getTableDesignMysql(config, database, table);
}

export function previewTableDesign(change: TableDesignChange): string {
  if (change.original.database && change.original.table) {
    // PG tables have no engine, MySQL tables do — use engine presence to decide
    if (change.original.engine === '') return previewTableDesignPg(change);
  }
  return previewTableDesignMysql(change);
}

export async function applyTableDesign(config: DbConnectionConfig, change: TableDesignChange, sql: string): Promise<TableDesignApplyResponse> {
  assertWritable(config);

  if (config.driver === 'postgres') {
    const generatedSql = previewTableDesignPg(change);
    if (sql.trim() && sql.trim() !== generatedSql.trim()) {
      throw new Error('表结构 SQL 已过期或被修改，请重新生成 ALTER 后再执行。');
    }
    if (!generatedSql.trim()) return { ok: true, sql: generatedSql, message: '没有需要执行的结构变更。' };

    const client = new pg.Client(pgConnectionOptions({ ...config, database: change.original.database }));
    try {
      await client.connect();
      // Execute each statement separately
      const lines = generatedSql.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      for (const line of lines) {
        await client.query(line);
      }
      return { ok: true, sql: generatedSql };
    } finally {
      await client.end();
    }
  }

  // MySQL
  const generatedSql = previewTableDesignMysql(change);
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
