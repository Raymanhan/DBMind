import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Wand2 } from 'lucide-react';
import type {
  DbmindApi,
  TableDesign,
  TableDesignColumn,
  TableDesignForeignKey,
  TableDesignIndex
} from '../../../shared/types';

type TableDesignerTarget = { database: string; table: string };

export function TableDesignerModal({
  api,
  connectionId,
  target,
  loading,
  onLoading,
  onNotice,
  onClose,
  onApplied
}: {
  api: DbmindApi;
  connectionId: string;
  target: TableDesignerTarget;
  loading: boolean;
  onLoading: (value: boolean) => void;
  onNotice: (message: string) => void;
  onClose: () => void;
  onApplied: () => Promise<void>;
}) {
  const [original, setOriginal] = useState<TableDesign | null>(null);
  const [draft, setDraft] = useState<TableDesign | null>(null);
  const [previewSql, setPreviewSql] = useState('');
  const [localLoading, setLocalLoading] = useState(false);
  const busy = loading || localLoading;
  const dirty = useMemo(() => Boolean(original && draft && JSON.stringify(original) !== JSON.stringify(draft)), [original, draft]);

  useEffect(() => {
    let mounted = true;
    setLocalLoading(true);
    api.getTableDesign(connectionId, target.database, target.table)
      .then((design) => {
        if (!mounted) return;
        setOriginal(cloneDesign(design));
        setDraft(cloneDesign(design));
        setPreviewSql('');
      })
      .catch((error) => {
        onNotice(error instanceof Error ? error.message : '表设计读取失败');
        onClose();
      })
      .finally(() => mounted && setLocalLoading(false));
    return () => {
      mounted = false;
    };
  }, [api, connectionId, target.database, target.table, onNotice]);

  function updateColumn(index: number, patch: Partial<TableDesignColumn>) {
    if (!draft) return;
    setDraft({ ...draft, columns: draft.columns.map((column, i) => (i === index ? { ...column, ...patch } : column)) });
    setPreviewSql('');
  }

  function addColumn() {
    if (!draft) return;
    setDraft({
      ...draft,
      columns: [
        ...draft.columns,
        { name: `new_column_${draft.columns.length + 1}`, type: 'varchar(255)', nullable: true, primary: false, defaultValue: '', comment: '' }
      ]
    });
    setPreviewSql('');
  }

  function updateIndex(index: number, patch: Partial<TableDesignIndex>) {
    if (!draft) return;
    setDraft({ ...draft, indexes: draft.indexes.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
    setPreviewSql('');
  }

  function addIndex(unique = false) {
    if (!draft) return;
    setDraft({
      ...draft,
      indexes: [...draft.indexes, { name: `${unique ? 'uk' : 'idx'}_${draft.indexes.length + 1}`, unique, columns: [] }]
    });
    setPreviewSql('');
  }

  function updateForeignKey(index: number, patch: Partial<TableDesignForeignKey>) {
    if (!draft) return;
    setDraft({ ...draft, foreignKeys: draft.foreignKeys.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
    setPreviewSql('');
  }

  function addForeignKey() {
    if (!draft) return;
    setDraft({
      ...draft,
      foreignKeys: [
        ...draft.foreignKeys,
        { name: `fk_${draft.table}_${draft.foreignKeys.length + 1}`, columns: [], referencedTable: '', referencedColumns: [], onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }
      ]
    });
    setPreviewSql('');
  }

  async function preview() {
    if (!original || !draft) return '';
    setLocalLoading(true);
    try {
      const sql = await api.previewTableDesign({ connectionId, change: { original, draft } });
      setPreviewSql(sql || '-- 没有需要执行的结构变更');
      return sql;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '生成 ALTER SQL 失败');
      return '';
    } finally {
      setLocalLoading(false);
    }
  }

  async function apply() {
    if (!original || !draft) return;
    const sql = previewSql && !previewSql.startsWith('--') ? previewSql : await preview();
    if (!sql.trim()) return;
    onLoading(true);
    try {
      const response = await api.applyTableDesign({ connectionId, change: { original, draft }, sql });
      await onApplied();
      onNotice(response.message ?? '表结构已更新');
      onClose();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '表结构变更失败');
    } finally {
      onLoading(false);
    }
  }

  function requestClose() {
    if (dirty && !window.confirm('表设计有未应用的修改，确定关闭吗？')) return;
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal-content table-designer-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>表设计器 · {target.database}.{target.table}</h2>
            <p>{dirty ? '有未应用的结构修改。生成 ALTER SQL 后再确认执行。' : '结构修改会先生成 ALTER SQL，确认后执行。'}</p>
          </div>
          <button className="icon-btn" onClick={requestClose}>✕</button>
        </div>
        {!draft ? (
          <div className="empty-state"><span className="spinner" /> 正在读取表结构...</div>
        ) : (
          <div className="designer-body">
            <section className="designer-section">
              <div className="designer-section-head">
                <h3>字段</h3>
                <button onClick={addColumn}><Plus size={14} /> 新增字段</button>
              </div>
              <div className="design-table-wrap">
                <table className="design-table">
                  <thead>
                    <tr>
                      <th>字段名</th>
                      <th>类型</th>
                      <th>可空</th>
                      <th>主键</th>
                      <th>自增</th>
                      <th>默认值</th>
                      <th>注释</th>
                      <th>删除</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.columns.map((column, index) => (
                      <tr key={`${column.originalName ?? column.name}-${index}`} className={column.dropped ? 'marked-drop' : ''}>
                        <td><input value={column.name} onChange={(event) => updateColumn(index, { name: event.target.value })} /></td>
                        <td><input value={column.type} onChange={(event) => updateColumn(index, { type: event.target.value })} /></td>
                        <td><input type="checkbox" checked={column.nullable} onChange={(event) => updateColumn(index, { nullable: event.target.checked })} /></td>
                        <td><input type="checkbox" checked={column.primary} onChange={(event) => updateColumn(index, { primary: event.target.checked })} /></td>
                        <td><input type="checkbox" checked={Boolean(column.autoIncrement)} onChange={(event) => updateColumn(index, { autoIncrement: event.target.checked })} /></td>
                        <td><input value={column.defaultValue ?? ''} onChange={(event) => updateColumn(index, { defaultValue: event.target.value })} /></td>
                        <td><input value={column.comment ?? ''} onChange={(event) => updateColumn(index, { comment: event.target.value })} /></td>
                        <td><button className="text-danger" onClick={() => updateColumn(index, { dropped: !column.dropped })}>{column.dropped ? '恢复' : '删除'}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="designer-grid">
              <div className="designer-section">
                <div className="designer-section-head">
                  <h3>索引</h3>
                  <div>
                    <button onClick={() => addIndex(false)}>普通</button>
                    <button onClick={() => addIndex(true)}>唯一</button>
                  </div>
                </div>
                {draft.indexes.map((index, i) => (
                  <div className={`designer-row ${index.dropped ? 'marked-drop' : ''}`} key={`${index.originalName ?? index.name}-${i}`}>
                    <input value={index.name} onChange={(event) => updateIndex(i, { name: event.target.value })} />
                    <label><input type="checkbox" checked={Boolean(index.unique)} onChange={(event) => updateIndex(i, { unique: event.target.checked })} /> 唯一</label>
                    <input value={index.columns.join(', ')} placeholder="字段，逗号分隔" onChange={(event) => updateIndex(i, { columns: splitColumnList(event.target.value) })} />
                    <button className="text-danger" onClick={() => updateIndex(i, { dropped: !index.dropped })}>{index.dropped ? '恢复' : '删除'}</button>
                  </div>
                ))}
              </div>

              <div className="designer-section">
                <div className="designer-section-head">
                  <h3>外键</h3>
                  <button onClick={addForeignKey}>新增外键</button>
                </div>
                {draft.foreignKeys.map((fk, i) => (
                  <div className={`designer-row fk-row ${fk.dropped ? 'marked-drop' : ''}`} key={`${fk.originalName ?? fk.name}-${i}`}>
                    <input value={fk.name} onChange={(event) => updateForeignKey(i, { name: event.target.value })} />
                    <input value={fk.columns.join(', ')} placeholder="本表字段" onChange={(event) => updateForeignKey(i, { columns: splitColumnList(event.target.value) })} />
                    <input value={fk.referencedTable} placeholder="引用表" onChange={(event) => updateForeignKey(i, { referencedTable: event.target.value })} />
                    <input value={fk.referencedColumns.join(', ')} placeholder="引用字段" onChange={(event) => updateForeignKey(i, { referencedColumns: splitColumnList(event.target.value) })} />
                    <select value={fk.onUpdate ?? ''} onChange={(event) => updateForeignKey(i, { onUpdate: event.target.value })}>
                      <option value="">ON UPDATE</option>
                      <option value="RESTRICT">RESTRICT</option>
                      <option value="CASCADE">CASCADE</option>
                      <option value="SET NULL">SET NULL</option>
                      <option value="NO ACTION">NO ACTION</option>
                    </select>
                    <select value={fk.onDelete ?? ''} onChange={(event) => updateForeignKey(i, { onDelete: event.target.value })}>
                      <option value="">ON DELETE</option>
                      <option value="RESTRICT">RESTRICT</option>
                      <option value="CASCADE">CASCADE</option>
                      <option value="SET NULL">SET NULL</option>
                      <option value="NO ACTION">NO ACTION</option>
                    </select>
                    <button className="text-danger" onClick={() => updateForeignKey(i, { dropped: !fk.dropped })}>{fk.dropped ? '恢复' : '删除'}</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="designer-section">
              <div className="designer-section-head"><h3>表属性</h3></div>
              <div className="settings-grid compact">
                <label>Engine<input value={draft.engine ?? ''} onChange={(event) => { setDraft({ ...draft, engine: event.target.value }); setPreviewSql(''); }} /></label>
                <label>Collation<input value={draft.collation ?? ''} onChange={(event) => { setDraft({ ...draft, collation: event.target.value }); setPreviewSql(''); }} /></label>
                <label className="wide">Comment<input value={draft.comment ?? ''} onChange={(event) => { setDraft({ ...draft, comment: event.target.value }); setPreviewSql(''); }} /></label>
              </div>
            </section>

            <section className="designer-section">
              <div className="designer-section-head">
                <h3>DDL 预览</h3>
                <div>
                  <button onClick={preview} disabled={busy}><Wand2 size={14} /> {localLoading ? '生成中' : '生成 ALTER'}</button>
                  <button className="primary" onClick={apply} disabled={busy || !draft || !dirty}><Save size={14} /> {loading ? '执行中' : '确认执行'}</button>
                </div>
              </div>
              <pre className="sql-preview">{previewSql || '点击“生成 ALTER”预览将要执行的结构变更。'}</pre>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function cloneDesign(design: TableDesign): TableDesign {
  return JSON.parse(JSON.stringify(design)) as TableDesign;
}

function splitColumnList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}
