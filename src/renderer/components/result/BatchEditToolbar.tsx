import { Edit3, Save, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface BatchCellEdit {
  rowIndex: number;
  column: string;
  newValue: string;
  originalValue: string;
  asNull: boolean;
}

export function BatchEditToolbar({
  edits,
  saving,
  onUndoAll,
  onUndoEdit,
  onSave
}: {
  edits: BatchCellEdit[];
  saving: boolean;
  onUndoAll: () => void;
  onUndoEdit: (rowIndex: number, column: string) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="batch-edit-toolbar">
      <div className="batch-edit-header">
        <span className="batch-edit-count">
          <Edit3 size={14} />
          {t('result.changeCount', { count: edits.length })}
        </span>
        <div className="batch-edit-header-actions">
          <button className="ghost" onClick={onUndoAll} title={t('result.undoAll')}>
            <Trash2 size={13} /> {t('result.undoAll')}
          </button>
          <button className="primary" onClick={onSave} disabled={saving}>
            <Save size={14} /> {saving ? t('result.saving') : t('result.save')}
          </button>
        </div>
      </div>
      <div className="batch-edit-list">
        {edits.map((edit) => (
          <div className="batch-edit-item" key={`${edit.rowIndex}:${edit.column}`}>
            <span className="batch-edit-col">{edit.column}</span>
            <span className="batch-edit-old">{edit.originalValue || 'NULL'}</span>
            <span className="batch-edit-arrow">&rarr;</span>
            <span className="batch-edit-new">{edit.asNull ? 'NULL' : edit.newValue}</span>
            <button className="batch-edit-undo" onClick={() => onUndoEdit(edit.rowIndex, edit.column)} title={t('result.undoOne')}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
