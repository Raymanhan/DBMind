import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Circle, Database, Edit3, History, Plus, RefreshCw, Search, Settings, Sparkles, Table2, Trash2 } from 'lucide-react';
import type { DatabaseInfo, DbConnectionConfig, TableSchema } from '../../../shared/types';

function tableKey(db: string, table: string): string {
  return `${db}.${table}`;
}

export const Sidebar = memo(function Sidebar({
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
  const { t } = useTranslation();
  const selectedObjectsCount = selectedDbs.reduce((total, dbName) => total + (schemaMap[dbName]?.length ?? 0), 0);

  return (
    <aside className="sidebar">
      <div className="panel-head">
        <span className="brand-text">DB<span className="brand-accent">Mind</span></span>
        <div className="panel-title">
          <span><Circle size={6} fill="currentColor" /></span>
          <strong>{activeConnection?.name ?? t('sidebar.notConnected')}</strong>
          <span>{activeConnection ? (activeConnection.driver === 'postgres' ? 'PG' : 'MySQL') : ''}</span>
        </div>
        <button className="icon-btn" title={t('sidebar.newConnection')} onClick={onNewConnection}><Plus size={15} /></button>
      </div>

      <div className="connection-list">
        {connections.length === 0 ? (
          <button className="sidebar-empty-action" onClick={onNewConnection}>
            <Plus size={15} />
            {t('sidebar.newConnection')}
          </button>
        ) : connections.map((c) => (
          <div className={`connection-item ${c.id === activeConnectionId ? 'active' : ''}`} key={c.id}>
            <button className="connection-main" onClick={() => onSelectConnection(c.id)}>
              <span className="connection-icon"><Database size={15} /></span>
              <span>{c.name}</span>
              <em>{c.driver === 'postgres' ? 'PostgreSQL' : 'MySQL'}</em>
            </button>
            <div className="row-actions">
              <button title={t('sidebar.editConnection')} onClick={() => onEditConnection(c)}><Edit3 size={13} /></button>
              <button title={t('sidebar.deleteConnection')} onClick={() => onDeleteConnection(c.id)}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="object-browser">
        <div className="section-title-row">
          <div className="section-label">{t('sidebar.objects')}</div>
          <span className="section-count">{selectedObjectsCount}</span>
        </div>
        {activeConnection?.driver === 'mysql' && databases.length > 0 && (
          <div className="db-multi-select">
            <button className="db-selector-head" onClick={onToggleDbSelector}>
              <ChevronDown size={14} className={`tree-chevron ${showDbSelector ? '' : 'open'}`} />
              <Database size={14} />
              <span>{selectedDbs.length ? t('sidebar.selectedDatabases', { count: selectedDbs.length }) : t('sidebar.selectDatabase')}</span>
              <span className="tiny-btn" onClick={(e) => { e.stopPropagation(); onRefreshSchemas(); }} title={t('sidebar.refresh')}><RefreshCw size={13} /></span>
            </button>
            {showDbSelector && (
              <div className="db-multi-dropdown">
                <div className="db-filter">
                  <Search size={13} />
                  <input placeholder={t('sidebar.filterDb')} value={dbFilter} onChange={(e) => onDbFilterChange(e.target.value)} onClick={(e) => e.stopPropagation()} />
                  {selectedDbs.length > 0 && <button onClick={onClearSelection}>{t('sidebar.clearAll')}</button>}
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
          <input placeholder={t('sidebar.search')} value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} onClick={(e) => e.stopPropagation()} />
          {searchQuery && <button className="search-clear" onClick={onClearSearch}>✕</button>}
        </div>
        {selectedDbs.length === 0 && !searchQuery && (
          <div className="tree-empty">{activeConnection ? t('sidebar.selectDatabaseToBrowse') : t('sidebar.createConnectionFirst')}</div>
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
        <button className={`footer-btn ${view === 'workspace' ? 'active' : ''}`} title={t('sidebar.database')} onClick={() => onNavigate('workspace')}><Database size={15} /></button>
        <button className={`footer-btn ${view === 'workspace' && !aiCollapsed ? 'active' : ''}`} title={t('ai.title')} onClick={onToggleAi}><Sparkles size={15} /></button>
        <button className="footer-btn" title={t('history.title')}><History size={15} /></button>
        <button className={`footer-btn ${view === 'settings' ? 'active' : ''}`} title={t('settings.title')} onClick={() => onNavigate('settings')}><Settings size={15} /></button>
      </div>
      <div className="resize-handle-col" onMouseDown={(e) => onStartResize('sidebar', sidebarWidth, e)} />
    </aside>
  );
});
