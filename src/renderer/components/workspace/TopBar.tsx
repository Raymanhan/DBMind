import { Edit3, Play, Wand2 } from 'lucide-react';
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
      <div>
        <h1>{workTab?.title || connection?.name || '未选择连接'}</h1>
        <p>{connection ? `${connection.driver === 'postgres' ? 'PostgreSQL' : 'MySQL'}` : 'MySQL'} · {selectedDbsCount} 个数据库 · {tableCount} 个对象 · {dbName && tableName ? `${dbName}.${tableName}` : defaultProvider ? `${defaultProvider.name || defaultProvider.provider} · ${defaultProvider.apiMode}` : 'Local AI'}</p>
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
