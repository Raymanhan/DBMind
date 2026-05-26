import { Save } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface SqlConfirmData {
  title: string;
  sql: string;
  onConfirm: () => Promise<void>;
}

export function SqlConfirmModal({
  data,
  loading,
  onClose
}: {
  data: SqlConfirmData | null;
  loading: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!data) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content sql-confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{data.title}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p className="modal-note">{t('dataEdit.sqlConfirmNote')}</p>
        <pre className="sql-preview">{data.sql}</pre>
        <div className="form-actions">
          <button onClick={onClose}>{t('connection.cancel')}</button>
          <button className="primary" onClick={data.onConfirm} disabled={loading}>
            <Save size={14} /> {loading ? t('topbar.running') : t('designer.confirmExecute')}
          </button>
        </div>
      </div>
    </div>
  );
}
