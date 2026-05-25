import { ChevronDown, Circle, Database, Edit3, History, Plus, RefreshCw, Search, Settings, Sparkles, Table2, Trash2 } from 'lucide-react';
import type { DatabaseInfo, DbConnectionConfig, TableSchema } from '../../../shared/types';

function tableKey(db: string, table: string): string {
  return `${db}.${table}`;
}

export function Sidebar({
  activeConnection,
  activeConnectionId,
  connections,
  databases,
  filteredDatabases,
  selectedDbs,
  expandedDbs,
  searchQuery,
  dbFilter,
  showDbSelector,
  schemaMap,
  dbTreeFiltered,
  selectedTable,
  mentionedTables,
  sidebarWidth,
  onSelectConnection,
  onNewConnection,
  onEditConnection,
  onDeleteConnection,
  onToggleDb,
  onToggleExpandDb,
  onToggleDbSelector,
  onSearchChange,
  onClearSearch,
  onDbFilterChange,
  onClearSelection,
  onRefreshSchemas,
  onSelectTable,
  onOpenTableTab,
  onStartResize,
  view,
  aiCollapsed,
  onNavigate,
  onToggleAi
}: {
  activeConnection?: DbConnectionConfig;
  activeConnectionId: string;
  connections: DbConnectionConfig[];
  databases: DatabaseInfo[];
  filteredDatabases: DatabaseInfo[];
  selectedDbs: string[];
  expandedDbs: Set<string>;
  searchQuery: string;
  dbFilter: string;
  showDbSelector: boolean;
  schemaMap: Record<string, TableSchema[]>;
  dbTreeFiltered: Record<string, TableSchema[]> | null;
  selectedTable: string;
  mentionedTables: string[];
  sidebarWidth: number;
  onSelectConnection: (id: string) => void;
  onNewConnection: () => void;
  onEditConnection: (c: DbConnectionConfig) => void;
  onDeleteConnection: (id: string) => void;
  onToggleDb: (db: string) => void;
  onToggleExpandDb: (db: string) => void;
  onToggleDbSelector: () => void;
  onSearchChange: (v: string) => void;
  onClearSearch: () => void;
  onDbFilterChange: (v: string) => void;
  onClearSelection: () => void;
  onRefreshSchemas: () => void;
  onSelectTable: (t: string) => void;
  onOpenTableTab: (db: string, t: TableSchema) => void;
  onStartResize: (target: 'sidebar', size: number, e: React.MouseEvent) => void;
  view: string;
  aiCollapsed: boolean;
  onNavigate: (v: string) => void;
  onToggleAi: () => void;
}) {
  const selectedObjectsCount = selectedDbs.reduce((total, dbName) => total + (schemaMap[dbName]?.length ?? 0), 0);

  return (
    <aside className="sidebar">
      <div className="panel-head">
        <span className="brand-text">DB<span className="brand-accent">Mind</span></span>
        <div className="panel-title">
          <span><Circle size={6} fill="currentColor" /></span>
          <strong>{activeConnection?.name ?? '未连接'}</strong>
          <span>{activeConnection ? (activeConnection.driver === 'postgres' ? 'PG' : 'MySQL') : ''}</span>
        </div>
        <button className="icon-btn" title="新建连接" onClick={onNewConnection}><Plus size={15} /></button>
      </div>

      <div className="connection-list">
        {connections.length === 0 ? (
          <button className="sidebar-empty-action" onClick={onNewConnection}>
            <Plus size={15} />
            新建连接
          </button>
        ) : connections.map((c) => (
          <div className={`connection-item ${c.id === activeConnectionId ? 'active' : ''}`} key={c.id}>
            <button className="connection-main" onClick={() => onSelectConnection(c.id)}>
              <span className="connection-icon"><Database size={15} /></span>
              <span>{c.name}</span>
              <em>{c.driver === 'postgres' ? 'PostgreSQL' : 'MySQL'}</em>
            </button>
            <div className="row-actions">
              <button title="编辑连接" onClick={() => onEditConnection(c)}><Edit3 size={13} /></button>
              <button title="删除连接" onClick={() => onDeleteConnection(c.id)}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="object-browser">
        <div className="section-title-row">
          <div className="section-label">对象</div>
          <span className="section-count">{selectedObjectsCount}</span>
        </div>
        {activeConnection?.driver === 'mysql' && databases.length > 0 && (
          <div className="db-multi-select">
            <button className="db-selector-head" onClick={onToggleDbSelector}>
              <ChevronDown size={14} className={`tree-chevron ${showDbSelector ? '' : 'open'}`} />
              <Database size={14} />
              <span>{selectedDbs.length ? `已选 ${selectedDbs.length} 个库` : '选择数据库'}</span>
              <span className="tiny-btn" onClick={(e) => { e.stopPropagation(); onRefreshSchemas(); }} title="刷新 Schema"><RefreshCw size={13} /></span>
            </button>
            {showDbSelector && (
              <div className="db-multi-dropdown">
                <div className="db-filter">
                  <Search size={13} />
                  <input placeholder="筛选数据库" value={dbFilter} onChange={(e) => onDbFilterChange(e.target.value)} onClick={(e) => e.stopPropagation()} />
                  {selectedDbs.length > 0 && <button onClick={onClearSelection}>清空</button>}
                </div>
                <div className="db-option-list">
                  {filteredDatabases.map((db) => (
                    <label key={db.name} className="db-check-row">
                      <input type="checkbox" checked={selectedDbs.includes(db.name)} onChange={() => onToggleDb(db.name)} />
                      <span>{db.system ? `${db.name} · system` : db.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div className="searchbox">
          <Search size={14} />
          <input placeholder="搜索对象" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} onClick={(e) => e.stopPropagation()} />
          {searchQuery && <button className="search-clear" onClick={onClearSearch}>✕</button>}
        </div>
        {selectedDbs.length === 0 && !searchQuery && (
          <div className="tree-empty">{activeConnection ? '选择数据库以浏览对象' : '先新建连接'}</div>
        )}
        {selectedDbs.map((dbName) => {
          const tables = searchQuery ? (dbTreeFiltered?.[dbName] ?? []) : schemaMap[dbName];
          if (!tables || tables.length === 0) return null;
          return (
            <div key={dbName} className="tree-group">
              <button className="tree-group-head db-root" onClick={() => onToggleExpandDb(dbName)}>
                <ChevronDown size={14} className={`tree-chevron ${expandedDbs.has(dbName) ? '' : 'open'}`} />
                <Database size={14} />
                <span>{dbName}</span>
                <em>{tables.length}</em>
              </button>
              {expandedDbs.has(dbName) && tables.map((t) => {
                const key = tableKey(dbName, t.name);
                const mentioned = mentionedTables.includes(t.name) || mentionedTables.includes(key);
                return (
                  <button
                    className={`table-item ${key === selectedTable ? 'active' : ''} ${mentioned ? 'mentioned' : ''}`}
                    key={key}
                    onClick={() => onSelectTable(key)}
                    onDoubleClick={() => onOpenTableTab(dbName, t)}
                  >
                    <Table2 size={15} />
                    <span>{t.name}</span>
                    <em>{t.columns.length}</em>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="sidebar-footer">
        <button className={`footer-btn ${view === 'workspace' ? 'active' : ''}`} title="数据库" onClick={() => onNavigate('workspace')}><Database size={15} /></button>
        <button className={`footer-btn ${view === 'workspace' && !aiCollapsed ? 'active' : ''}`} title="AI 助手" onClick={onToggleAi}><Sparkles size={15} /></button>
        <button className="footer-btn" title="历史"><History size={15} /></button>
        <button className={`footer-btn ${view === 'settings' ? 'active' : ''}`} title="设置" onClick={() => onNavigate('settings')}><Settings size={15} /></button>
      </div>
      <div className="resize-handle-col" onMouseDown={(e) => onStartResize('sidebar', sidebarWidth, e)} />
    </aside>
  );
}
