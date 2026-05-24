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
  if (!history.length) {
    return <div className="empty-state">暂无查询历史。执行 SQL 后会自动记录最近 200 条。</div>;
  }

  return (
    <div className="history-panel">
      <div className="history-toolbar">
        <span>最近 {history.length} 条查询</span>
        <button onClick={onClear}>清空历史</button>
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
