import { Bot, Database, Edit3, Layers3, Play, Server, Table2, Wand2 } from 'lucide-react';
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
  onAiGenerate,
  onDesignTable
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
  onAiGenerate: () => void;
  onDesignTable: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-copy">
        <h1>{workTab?.title || connection?.name || '未选择连接'}</h1>
        <div className="topbar-meta">
          <span><Server size={13} />{connection ? (connection.driver === 'postgres' ? 'PostgreSQL' : 'MySQL') : 'MySQL'}</span>
          <span><Database size={13} />{selectedDbsCount} 数据库</span>
          <span><Layers3 size={13} />{tableCount} 对象</span>
          {dbName && tableName ? (
            <span><Table2 size={13} />{dbName}.{tableName}</span>
          ) : defaultProvider ? (
            <span><Bot size={13} />{defaultProvider.name || defaultProvider.provider} · {defaultProvider.apiMode}</span>
          ) : (
            <span><Bot size={13} />Local AI</span>
          )}
        </div>
      </div>
      <div className="topbar-actions">
        {workTab?.kind === 'table' && dbName && tableName && (
          <button className="ghost" onClick={onDesignTable} disabled={queryLoading || aiLoading}>
            <Edit3 size={15} /> 表设计
          </button>
        )}
        <button className="ghost" onClick={onAiGenerate} disabled={aiLoading || queryLoading}><Wand2 size={15} /> {aiLoading ? '生成中' : 'AI 优化'}</button>
        <button className="run-btn" onClick={onRunQuery} disabled={queryLoading || aiLoading}><Play size={16} /> {queryLoading ? '执行中' : '执行'}</button>
      </div>
    </header>
  );
}
