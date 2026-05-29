import { useState, useCallback, useEffect, useRef } from 'react';
import { X, Plus, Trash2, Save, Key, AlertCircle } from 'lucide-react';
import { executeQuery, refreshSchema, getSchema } from '../../shared/api/tauri';
import { useConnectionStore } from '../../shared/stores/connectionStore';
import { useEditorStore } from '../../shared/stores/editorStore';
import { useQueryStore } from '../../shared/stores/queryStore';
import type { ColumnMeta, IndexMeta, DatabaseDriver } from '../../shared/api/types';

/* ─── Column row type used inside the modal ─── */
interface ColumnRow {
  id: string;
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  default_value: string;
  comment: string;
  max_length: string;
  decimal_digits: string;
  _status: 'unchanged' | 'added' | 'modified' | 'removed';
  _original?: Omit<ColumnRow, 'id' | '_status' | '_original'>;
}

/* ─── Common MySQL / PG types for dropdown ─── */
const MYSQL_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
  'DECIMAL', 'FLOAT', 'DOUBLE',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
  'BLOB', 'MEDIUMBLOB', 'LONGBLOB', 'TINYBLOB',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME',
  'BOOLEAN',
  'JSON',
  'ENUM',
  'BINARY', 'VARBINARY',
];

const PG_TYPES = [
  'INTEGER', 'BIGINT', 'SMALLINT', 'SERIAL', 'BIGSERIAL',
  'DECIMAL', 'NUMERIC', 'REAL', 'DOUBLE PRECISION',
  'CHARACTER VARYING', 'CHARACTER', 'TEXT',
  'DATE', 'TIMESTAMP WITHOUT TIME ZONE', 'TIMESTAMP WITH TIME ZONE', 'TIME',
  'BOOLEAN',
  'JSON', 'JSONB',
  'UUID',
  'BYTEA',
  'INET', 'CIDR',
];

function uid(): string {
  return crypto.randomUUID();
}

function emptyColumn(): ColumnRow {
  return {
    id: uid(),
    name: '',
    data_type: 'VARCHAR',
    nullable: true,
    is_primary_key: false,
    default_value: '',
    comment: '',
    max_length: '',
    decimal_digits: '',
    _status: 'added',
  };
}

function metaToRow(col: ColumnMeta): ColumnRow {
  const row: ColumnRow = {
    id: uid(),
    name: col.name,
    data_type: col.data_type,
    nullable: col.nullable,
    is_primary_key: col.is_primary_key,
    default_value: col.default_value ?? '',
    comment: col.comment ?? '',
    max_length: col.max_length != null ? String(col.max_length) : '',
    decimal_digits: col.decimal_digits != null ? String(col.decimal_digits) : '',
    _status: 'unchanged',
  };
  row._original = { ...row };
  return row;
}

/* ─── Props ─── */
export interface TableStructureModalProps {
  mode: 'create' | 'alter';
  database: string;
  tableName?: string;          // undefined when mode === 'create'
  driver: DatabaseDriver;
  onClose: () => void;
  onSaved: () => void;
}

export function TableStructureModal({
  mode,
  database,
  tableName,
  driver,
  onClose,
  onSaved,
}: TableStructureModalProps) {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const openTab = useEditorStore((s) => s.openTab);

  const isPostgres = driver === 'postgres';

  /* ── State ── */
  const [name, setName] = useState(tableName ?? '');
  const [tableComment, setTableComment] = useState('');
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(mode === 'alter');
  const nameRef = useRef<HTMLInputElement>(null);

  const types = isPostgres ? PG_TYPES : MYSQL_TYPES;

  /* ── Load existing columns on alter ── */
  useEffect(() => {
    if (mode !== 'alter' || !tableName) return;
    setLoading(true);
    getSchema(database, tableName)
      .then((schemas) => {
        const tbl = schemas[0];
        if (!tbl) return;
        setColumns(tbl.columns.map(metaToRow));
        setTableComment(tbl.comment ?? '');
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [mode, database, tableName]);

  // Focus table name on create
  useEffect(() => {
    if (mode === 'create') nameRef.current?.focus();
  }, [mode]);

  /* ── Column helpers ── */
  const addColumn = useCallback(() => {
    setColumns((prev) => [...prev, emptyColumn()]);
  }, []);

  const removeColumn = useCallback((id: string) => {
    setColumns((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, _status: c._status === 'added' ? 'removed' : 'removed' }
          : c,
      ),
    );
  }, []);

  const updateColumn = useCallback((id: string, patch: Partial<ColumnRow>) => {
    setColumns((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        if (next._status === 'unchanged') next._status = 'modified';
        return next;
      }),
    );
  }, []);

  /* ── DDL generation ── */
  function buildColumnDef(col: ColumnRow, forCreate: boolean): string {
    let type = col.data_type;

    // Append length / precision
    const needsLength = /VARCHAR|CHAR|CHARACTER VARYING|CHARACTER|BINARY|VARBINARY|DECIMAL|NUMERIC/i.test(type);
    if (needsLength) {
      const parts: string[] = [];
      if (col.max_length) parts.push(col.max_length);
      if (col.decimal_digits) parts.push(col.decimal_digits);
      if (parts.length > 0) type += `(${parts.join(',')})`;
    }

    const q = isPostgres
      ? (n: string) => `"${n.replace(/"/g, '""')}"`
      : (n: string) => `\`${n.replace(/`/g, '``')}\``;

    let def = `${q(col.name)} ${type}`;
    if (!col.nullable) def += ' NOT NULL';

    if (col.default_value) {
      def += ` DEFAULT ${col.default_value}`;
    }

    if (col.is_primary_key && forCreate && !isPostgres) {
      def += ' PRIMARY KEY';
    }

    if (!isPostgres && col.comment) {
      def += ` COMMENT '${col.comment.replace(/'/g, "''")}'`;
    }

    return def;
  }

  function generateCreateSQL(): string {
    const q = isPostgres
      ? (n: string) => `"${n.replace(/"/g, '""')}"`
      : (n: string) => `\`${n.replace(/`/g, '``')}\``;

    const activeCols = columns.filter((c) => c._status !== 'removed');
    if (activeCols.length === 0) throw new Error('请至少添加一列');

    const colDefs = activeCols.map((c) => '  ' + buildColumnDef(c, true));

    // Postgres: add PK constraint separately
    if (isPostgres) {
      const pkCols = activeCols.filter((c) => c.is_primary_key);
      if (pkCols.length > 0) {
        colDefs.push(`  PRIMARY KEY (${pkCols.map((c) => q(c.name)).join(', ')})`);
      }
    }

    let sql = `CREATE TABLE ${q(name)} (\n${colDefs.join(',\n')}\n)`;

    if (!isPostgres && tableComment) {
      sql += ` COMMENT='${tableComment.replace(/'/g, "''")}'`;
    }

    sql += ';';

    // PG: table comment
    if (isPostgres && tableComment) {
      sql += `\n\nCOMMENT ON TABLE ${q(name)} IS '${tableComment.replace(/'/g, "''")}';`;
    }

    // PG: column comments
    if (isPostgres) {
      for (const col of activeCols) {
        if (col.comment) {
          sql += `\nCOMMENT ON COLUMN ${q(name)}.${q(col.name)} IS '${col.comment.replace(/'/g, "''")}';`;
        }
      }
    }

    return sql;
  }

  function generateAlterSQL(): string {
    const q = isPostgres
      ? (n: string) => `"${n.replace(/"/g, '""')}"`
      : (n: string) => `\`${n.replace(/`/g, '``')}\``;

    const tbl = q(tableName!);
    const stmts: string[] = [];

    for (const col of columns) {
      if (col._status === 'added') {
        stmts.push(
          `ALTER TABLE ${tbl} ADD COLUMN ${buildColumnDef(col, false)};`,
        );
      } else if (col._status === 'removed') {
        stmts.push(`ALTER TABLE ${tbl} DROP COLUMN ${q(col.name)};`);
      } else if (col._status === 'modified') {
        const orig = col._original;
        if (!isPostgres) {
          // MySQL: MODIFY COLUMN — only if something actually changed
          if (!orig || col.data_type !== orig.data_type || col.max_length !== orig.max_length
            || col.decimal_digits !== orig.decimal_digits || col.nullable !== orig.nullable
            || col.is_primary_key !== orig.is_primary_key || col.default_value !== orig.default_value
            || col.comment !== orig.comment) {
            stmts.push(
              `ALTER TABLE ${tbl} MODIFY COLUMN ${buildColumnDef(col, false)};`,
            );
          }
        } else if (orig) {
          // PG: only emit ALTER statements for fields that actually changed
          const alterPrefix = `ALTER TABLE ${tbl}`;
          const colRef = q(col.name);
          if (col.data_type !== orig.data_type || col.max_length !== orig.max_length || col.decimal_digits !== orig.decimal_digits) {
            let type = col.data_type;
            const needsLength = /VARCHAR|CHAR|CHARACTER VARYING|CHARACTER|BINARY|VARBINARY|DECIMAL|NUMERIC/i.test(type);
            if (needsLength) {
              const parts: string[] = [];
              if (col.max_length) parts.push(col.max_length);
              if (col.decimal_digits) parts.push(col.decimal_digits);
              if (parts.length > 0) type += `(${parts.join(',')})`;
            }
            stmts.push(`${alterPrefix} ALTER COLUMN ${colRef} TYPE ${type};`);
          }
          if (col.nullable !== orig.nullable) {
            if (col.nullable) {
              stmts.push(`${alterPrefix} ALTER COLUMN ${colRef} DROP NOT NULL;`);
            } else {
              stmts.push(`${alterPrefix} ALTER COLUMN ${colRef} SET NOT NULL;`);
            }
          }
          if (col.default_value !== orig.default_value) {
            if (col.default_value) {
              stmts.push(`${alterPrefix} ALTER COLUMN ${colRef} SET DEFAULT ${col.default_value};`);
            } else {
              stmts.push(`${alterPrefix} ALTER COLUMN ${colRef} DROP DEFAULT;`);
            }
          }
          if (col.comment !== orig.comment) {
            stmts.push(`COMMENT ON COLUMN ${tbl}.${colRef} IS '${col.comment.replace(/'/g, "''")}';`);
          }
        }
      }
    }

    if (stmts.length === 0) throw new Error('没有变更需要保存');

    return stmts.join('\n');
  }

  /* ── Save ── */
  const handleSave = useCallback(async () => {
    if (!activeConnectionId) return;
    setError(null);

    if (!name.trim()) {
      setError('请输入表名');
      return;
    }

    const activeCols = columns.filter((c) => c._status !== 'removed');
    if (mode === 'create' && activeCols.length === 0) {
      setError('请至少添加一列');
      return;
    }

    // Validate column names
    for (const col of activeCols) {
      if (!col.name.trim()) {
        setError('列名不能为空');
        return;
      }
    }

    try {
      const sql = mode === 'create' ? generateCreateSQL() : generateAlterSQL();

      const queryId = uid();
      const result = await executeQuery(activeConnectionId, sql, queryId);

      if (result.error) {
        setError(result.error);
        return;
      }

      // Refresh schema
      await refreshSchema(activeConnectionId, database);
      onSaved();
      onClose();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, [activeConnectionId, name, columns, mode, database, onClose, onSaved]);

  /* ── Preview SQL in editor tab ── */
  const handlePreviewSQL = useCallback(() => {
    if (!activeConnectionId) return;
    setError(null);

    try {
      const sql = mode === 'create' ? generateCreateSQL() : generateAlterSQL();
      const tabId = uid();
      openTab({
        id: tabId,
        title: mode === 'create' ? `Create ${name}` : `Alter ${tableName}`,
        sql,
        connectionId: activeConnectionId,
        database,
        dirty: true,
      });
      onClose();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, [activeConnectionId, name, columns, mode, database, tableName, openTab, onClose]);

  const activeCols = columns.filter((c) => c._status !== 'removed');

  /* ── Render ── */
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal table-structure-modal"
        style={{ width: 780, maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <h2>{mode === 'create' ? `✨ 新建表 — ${database}` : `🔧 表结构 — ${database}.${tableName}`}</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body table-structure-body">
          {/* Table name + comment */}
          <div className="form-row">
            <div className="form-group flex-2">
              <label>表名</label>
              <input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={mode === 'alter'}
                placeholder="table_name"
              />
            </div>
            <div className="form-group flex-3">
              <label>表注释</label>
              <input
                value={tableComment}
                onChange={(e) => setTableComment(e.target.value)}
                placeholder="Optional comment"
              />
            </div>
          </div>

          {error && (
            <div className="form-message error">
              <AlertCircle size={13} style={{ verticalAlign: -2, marginRight: 6 }} />
              {error}
            </div>
          )}

          {/* Column table */}
          <div className="column-table-wrap">
            <table className="column-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th style={{ width: 160 }}>列名</th>
                  <th style={{ width: 160 }}>类型</th>
                  <th style={{ width: 70 }}>长度</th>
                  <th style={{ width: 70 }}>小数位</th>
                  <th style={{ width: 56 }}>可空</th>
                  <th style={{ width: 40 }}>PK</th>
                  <th style={{ width: 100 }}>默认值</th>
                  <th style={{ minWidth: 100 }}>注释</th>
                  <th style={{ width: 36 }} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: 24, color: 'var(--color-text-muted)' }}>
                      加载中…
                    </td>
                  </tr>
                ) : (
                  columns.map((col, idx) => {
                    if (col._status === 'removed') return null;
                    return (
                      <tr key={col.id} className={col._status !== 'unchanged' ? 'row-changed' : ''}>
                        <td className="col-idx">{idx + 1}</td>
                        <td>
                          <input
                            className="col-input"
                            value={col.name}
                            onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                            placeholder="column_name"
                          />
                        </td>
                        <td>
                          <select
                            className="col-input"
                            value={col.data_type}
                            onChange={(e) => updateColumn(col.id, { data_type: e.target.value })}
                          >
                            {types.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                            {/* Keep custom value if not in list */}
                            {!types.includes(col.data_type) && (
                              <option value={col.data_type}>{col.data_type}</option>
                            )}
                          </select>
                        </td>
                        <td>
                          <input
                            className="col-input"
                            value={col.max_length}
                            onChange={(e) => updateColumn(col.id, { max_length: e.target.value })}
                            placeholder="—"
                          />
                        </td>
                        <td>
                          <input
                            className="col-input"
                            value={col.decimal_digits}
                            onChange={(e) => updateColumn(col.id, { decimal_digits: e.target.value })}
                            placeholder="—"
                          />
                        </td>
                        <td className="col-center">
                          <input
                            type="checkbox"
                            checked={col.nullable}
                            onChange={(e) => updateColumn(col.id, { nullable: e.target.checked })}
                          />
                        </td>
                        <td className="col-center">
                          <input
                            type="checkbox"
                            checked={col.is_primary_key}
                            onChange={(e) => updateColumn(col.id, { is_primary_key: e.target.checked })}
                          />
                        </td>
                        <td>
                          <input
                            className="col-input"
                            value={col.default_value}
                            onChange={(e) => updateColumn(col.id, { default_value: e.target.value })}
                            placeholder="—"
                          />
                        </td>
                        <td>
                          <input
                            className="col-input"
                            value={col.comment}
                            onChange={(e) => updateColumn(col.id, { comment: e.target.value })}
                            placeholder="—"
                          />
                        </td>
                        <td>
                          <button
                            className="col-delete-btn"
                            title="删除此列"
                            onClick={() => removeColumn(col.id)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <button className="btn btn-secondary add-col-btn" onClick={addColumn}>
            <Plus size={14} /> 添加列
          </button>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handlePreviewSQL}>
            预览 SQL
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            <Save size={14} /> {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
