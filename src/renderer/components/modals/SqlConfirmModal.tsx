import { Save } from 'lucide-react';

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
  if (!data) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content sql-confirm-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{data.title}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p className="modal-note">确认后会执行以下写入 SQL，执行成功后自动刷新当前结果集。</p>
        <pre className="sql-preview">{data.sql}</pre>
        <div className="form-actions">
          <button onClick={onClose}>取消</button>
          <button className="primary" onClick={data.onConfirm} disabled={loading}>
            <Save size={14} /> {loading ? '执行中' : '确认执行'}
          </button>
        </div>
      </div>
    </div>
  );
}
