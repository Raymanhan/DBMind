import { useTranslation } from 'react-i18next';
import type { QueryHistoryItem } from '../../../shared/types';

export function HistoryPanel({
  history,
  onUseSql,
  onClear
}: {
  history: QueryHistoryItem[];
  onUseSql: (sql: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  if (!history.length) {
    return <div className="empty-state">{t('history.emptyDescription')}</div>;
  }

  return (
    <div className="history-panel">
      <div className="history-toolbar">
        <span>{t('history.recentCount', { count: history.length })}</span>
        <button onClick={onClear}>{t('history.clear')}</button>
      </div>
      {history.map((item) => (
        <button className="history-item" key={item.id} onClick={() => onUseSql(item.sql)}>
          <div>
            <strong>{item.database || item.connectionName}</strong>
            <span>{new Date(item.createdAt).toLocaleString()} · {item.source ?? 'query'} · {item.rowCount} rows · {item.durationMs}ms</span>
          </div>
          <pre>{item.sql}</pre>
        </button>
      ))}
    </div>
  );
}
