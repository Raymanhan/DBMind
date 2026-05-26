import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
        onNotice(error instanceof Error ? error.message : t('designer.loadFailed'));
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
      setPreviewSql(sql || `-- ${t('designer.noChanges')}`);
      return sql;
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('designer.previewFailed'));
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
      onNotice(response.message ?? t('designer.updated'));
      onClose();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : t('designer.applyFailed'));
    } finally {
      onLoading(false);
    }
  }

  function requestClose() {
    if (dirty && !window.confirm(t('designer.confirmClose'))) return;
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={requestClose}>
      <div className="modal-content table-designer-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{t('designer.title')} · {target.database}.{target.table}</h2>
            <p>{dirty ? t('designer.dirtyDescription') : t('designer.cleanDescription')}</p>
          </div>
          <button className="icon-btn" onClick={requestClose}>✕</button>
        </div>
        {!draft ? (
          <div className="empty-state"><span className="spinner" /> {t('designer.loading')}</div>
        ) : (
          <div className="designer-body">
            <section className="designer-section">
              <div className="designer-section-head">
                <h3>{t('designer.columns')}</h3>
                <button onClick={addColumn}><Plus size={14} /> {t('designer.addColumn')}</button>
              </div>
              <div className="design-table-wrap">
                <table className="design-table">
                  <thead>
                    <tr>
                      <th>{t('designer.columnName')}</th>
                      <th>{t('designer.type')}</th>
                      <th>{t('designer.nullable')}</th>
                      <th>{t('designer.primaryKey')}</th>
                      <th>{t('designer.autoIncrement')}</th>
                      <th>{t('designer.defaultValue')}</th>
                      <th>{t('designer.comment')}</th>
                      <th>{t('settings.delete')}</th>
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
                        <td><button className="text-danger" onClick={() => updateColumn(index, { dropped: !column.dropped })}>{column.dropped ? t('designer.restore') : t('settings.delete')}</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="designer-grid">
              <div className="designer-section">
                <div className="designer-section-head">
                  <h3>{t('designer.indexes')}</h3>
                  <div>
                    <button onClick={() => addIndex(false)}>{t('designer.normal')}</button>
                    <button onClick={() => addIndex(true)}>{t('designer.unique')}</button>
                  </div>
                </div>
                {draft.indexes.map((index, i) => (
                  <div className={`designer-row ${index.dropped ? 'marked-drop' : ''}`} key={`${index.originalName ?? index.name}-${i}`}>
                    <input value={index.name} onChange={(event) => updateIndex(i, { name: event.target.value })} />
                    <label><input type="checkbox" checked={Boolean(index.unique)} onChange={(event) => updateIndex(i, { unique: event.target.checked })} /> {t('designer.unique')}</label>
                    <input value={index.columns.join(', ')} placeholder={t('designer.columnsPlaceholder')} onChange={(event) => updateIndex(i, { columns: splitColumnList(event.target.value) })} />
                    <button className="text-danger" onClick={() => updateIndex(i, { dropped: !index.dropped })}>{index.dropped ? t('designer.restore') : t('settings.delete')}</button>
                  </div>
                ))}
              </div>

              <div className="designer-section">
                <div className="designer-section-head">
                  <h3>{t('designer.foreignKeys')}</h3>
                  <button onClick={addForeignKey}>{t('designer.addForeignKey')}</button>
                </div>
                {draft.foreignKeys.map((fk, i) => (
                  <div className={`designer-row fk-row ${fk.dropped ? 'marked-drop' : ''}`} key={`${fk.originalName ?? fk.name}-${i}`}>
                    <input value={fk.name} onChange={(event) => updateForeignKey(i, { name: event.target.value })} />
                    <input value={fk.columns.join(', ')} placeholder={t('designer.localColumns')} onChange={(event) => updateForeignKey(i, { columns: splitColumnList(event.target.value) })} />
                    <input value={fk.referencedTable} placeholder={t('designer.referencedTable')} onChange={(event) => updateForeignKey(i, { referencedTable: event.target.value })} />
                    <input value={fk.referencedColumns.join(', ')} placeholder={t('designer.referencedColumns')} onChange={(event) => updateForeignKey(i, { referencedColumns: splitColumnList(event.target.value) })} />
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
                    <button className="text-danger" onClick={() => updateForeignKey(i, { dropped: !fk.dropped })}>{fk.dropped ? t('designer.restore') : t('settings.delete')}</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="designer-section">
              <div className="designer-section-head"><h3>{t('designer.tableProperties')}</h3></div>
              <div className="settings-grid compact">
                <label>Engine<input value={draft.engine ?? ''} onChange={(event) => { setDraft({ ...draft, engine: event.target.value }); setPreviewSql(''); }} /></label>
                <label>Collation<input value={draft.collation ?? ''} onChange={(event) => { setDraft({ ...draft, collation: event.target.value }); setPreviewSql(''); }} /></label>
                <label className="wide">Comment<input value={draft.comment ?? ''} onChange={(event) => { setDraft({ ...draft, comment: event.target.value }); setPreviewSql(''); }} /></label>
              </div>
            </section>

            <section className="designer-section">
              <div className="designer-section-head">
                <h3>{t('designer.ddlPreview')}</h3>
                <div>
                  <button onClick={preview} disabled={busy}><Wand2 size={14} /> {localLoading ? t('designer.generating') : t('designer.generateAlter')}</button>
                  <button className="primary" onClick={apply} disabled={busy || !draft || !dirty}><Save size={14} /> {loading ? t('topbar.running') : t('designer.confirmExecute')}</button>
                </div>
              </div>
              <pre className="sql-preview">{previewSql || t('designer.previewHint')}</pre>
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
