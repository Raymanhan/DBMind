import { useTranslation } from 'react-i18next';
import { ConnectionForm } from './ConnectionForm';
import type { DatabaseInfo, DbConnectionConfig } from '../../../shared/types';

export function ConnectionModal({
  open,
  connectionDraft,
  databases,
  loading,
  onClose,
  onChange,
  onSave,
  onTest
}: {
  open: boolean;
  connectionDraft: DbConnectionConfig;
  databases: DatabaseInfo[];
  loading: boolean;
  onClose: () => void;
  onChange: (draft: DbConnectionConfig) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="modal-overlay">
      <div className="modal-content" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h2>{connectionDraft.id ? t('sidebar.editConnection') : t('sidebar.newConnection')}</h2>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <ConnectionForm
          draft={connectionDraft}
          databases={databases}
          onChange={onChange}
          onSave={onSave}
          onTest={onTest}
          loading={loading}
        />
      </div>
    </div>
  );
}
