import { Database, Table2 } from 'lucide-react';
import type { WorkTab } from '../../../shared/types';

export function WorkTabStrip({
  workTabs,
  activeWorkTabId,
  onSelectTab,
  onCloseTab
}: {
  workTabs: WorkTab[];
  activeWorkTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
}) {
  return (
    <div className="work-tab-strip">
      {workTabs.map((tab) => (
        <button
          className={`work-tab ${tab.id === activeWorkTabId ? 'active' : ''}`}
          key={tab.id}
          onClick={() => onSelectTab(tab.id)}
          title={tab.dbName ? `${tab.dbName}.${tab.tableName}` : tab.title}
        >
          {tab.kind === 'table' ? <Table2 size={13} /> : <Database size={13} />}
          <span>{tab.title}</span>
          {tab.id !== 'console' && (
            <em onClick={(event) => { event.stopPropagation(); onCloseTab(tab.id); }}>×</em>
          )}
        </button>
      ))}
    </div>
  );
}
