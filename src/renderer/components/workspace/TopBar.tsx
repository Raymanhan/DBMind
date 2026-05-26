import { Database, Edit3, Play, Server, Sparkles, Table2, Wand2 } from 'lucide-react';
import type { AiProviderConfig, DbConnectionConfig, WorkTab } from '../../../shared/types';

export function TopBar({
  workTab,
  connection,
  selectedDbsCount,
  tableCount,
  defaultProvider,
  dbName,
  tableName,
  queryLoading,
  aiLoading,
  onRunQuery,
  onDesignTable,
  onOptimizeSql
}: {
  workTab?: WorkTab;
  connection?: DbConnectionConfig;
  selectedDbsCount: number;
  tableCount: number;
  defaultProvider?: AiProviderConfig;
  dbName?: string;
  tableName?: string;
  queryLoading: boolean;
  aiLoading: boolean;
  onRunQuery: () => void;
  onDesignTable: () => void;
  onOptimizeSql: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <strong className="topbar-title">{workTab?.title || connection?.name || 'DBMind'}</strong>
        <span className="topbar-driver"><Server size={11} />{connection ? (connection.driver === 'postgres' ? 'PG' : 'MySQL') : ''}</span>
        {dbName && tableName && <span className="topbar-table"><Table2 size={11} />{dbName}.{tableName}</span>}
        {defaultProvider && <span className="topbar-ai"><Sparkles size={11} />{defaultProvider.name}</span>}
      </div>
      <div className="topbar-actions">
        {workTab?.kind === 'table' && dbName && tableName && (
          <button className="ghost" onClick={onDesignTable} disabled={queryLoading || aiLoading}>
            <Edit3 size={13} /> 设计
          </button>
        )}
        {defaultProvider && (
          <button className="ghost" onClick={onOptimizeSql} disabled={queryLoading || aiLoading}>
            <Wand2 size={13} /> 优化
          </button>
        )}
        <button className="run-btn" onClick={() => onRunQuery()} disabled={queryLoading || aiLoading}><Play size={14} /> {queryLoading ? '执行中' : '执行'}</button>
      </div>
    </header>
  );
}
