import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Database,
  Edit3,
  Plus,
  RefreshCw,
  Save,
  Search,
  Table2,
  Trash2
} from 'lucide-react';
import type {
  AiGenerateResponse,
  AiProviderConfig,
  AppSettings,
  AppTheme,
  BatchCellEditEntry,
  BatchUpdateCellRequest,
  DatabaseInfo,
  DbConnectionConfig,
  DbmindApi,
  QueryHistoryItem,
  QueryResult,
  ResultTab,
  TableSchema,
  WorkTab
} from '../shared/types';
import { extractTableMentions } from '../shared/sqlTools';
import { AiPanel } from './components/ai/AiPanel';
import { ConnectionModal } from './components/connection/ConnectionModal';
import { SqlEditor } from './components/editor/SqlEditor';
import { SqlConfirmModal } from './components/modals/SqlConfirmModal';
import { LeftRail } from './components/navigation/LeftRail';
import { BatchEditToolbar } from './components/result/BatchEditToolbar';
import { HistoryPanel } from './components/result/HistoryPanel';
import { Sidebar } from './components/sidebar/Sidebar';
import { TableDesignerModal } from './components/schema/TableDesigner';
import { TopBar } from './components/workspace/TopBar';
import { WorkTabStrip } from './components/workspace/WorkTabStrip';
import { SettingsView } from './components/settings/SettingsView';
import { useBatchEdit } from './hooks/useBatchEdit';
import { useConnections } from './hooks/useConnections';
import { useSettings } from './hooks/useSettings';
import { useSchema } from './hooks/useSchema';
import { useWorkTabs } from './hooks/useWorkTabs';
import { useAiAssistant } from './hooks/useAiAssistant';
import { browserFallbackApi } from './browserApi';

type AppView = 'workspace' | 'settings';
type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  meta?: string;
  warnings?: string[];
};
type BatchCellEdit = {
  rowIndex: number;
  column: string;
  newValue: string;
  originalValue: string;
  asNull: boolean;
};
import type { SqlConfirmData } from './components/modals/SqlConfirmModal';

const api: DbmindApi = window.dbmind ?? browserFallbackApi;

const seedSql = `SELECT 1 AS connected;`;

const emptyConnection: DbConnectionConfig = {
  id: '',
  name: '',
  driver: 'mysql',
  host: 'localhost',
  port: 3306,
  database: '',
  user: 'root',
  password: '',
  charset: 'utf8mb4',
  timezone: 'local',
  connectTimeout: 10000,
  readonly: false,
  ssl: false
};

const emptyAiProvider: AiProviderConfig = {
  id: '',
  name: 'OpenAI Compatible',
  provider: 'openai-compatible',
  apiMode: 'chat-completions',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5-mini',
  temperature: 0.2,
  maxOutputTokens: 1200,
  timeoutMs: 30000,
  streaming: false,
  defaultDialect: 'mysql',
  allowWriteSql: false,
  appendLimit: true
};

function formatDatetime(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Date) return formatDatetime(value);
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function driverLabel(driver: string): string {
  return driver === 'postgres' ? 'PostgreSQL' : 'MySQL';
}

function providerLabel(provider: AiProviderConfig): string {
  return `${provider.name || provider.provider} · ${provider.apiMode}`;
}

import { mysqlTableRef, quoteMysqlIdentifier } from '../shared/sql/identifiers';

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;+\s*$/, '');
}

function createConsoleTab(): WorkTab {
  return {
    id: 'console',
    title: 'SQL Console',
    kind: 'sql',
    baseSql: seedSql,
    sql: seedSql,
    result: null,
    resultTab: 'results',
    sort: undefined
  };
}

export function App() {
  const [view, setView] = useState<AppView>('workspace');
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [aiPanelWidth, setAiPanelWidth] = useState(300);
  const [aiCollapsed, setAiCollapsed] = useState(() => window.innerWidth < 1360);
  const [editorHeightPx, setEditorHeightPx] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState({ query: false, ai: false, connection: false, settings: false });
  const busy = loading.query || loading.ai || loading.connection || loading.settings;
  const [tableDesignerTarget, setTableDesignerTarget] = useState<{ database: string; table: string } | null>(null);

  function setLoadingFlag(key: keyof typeof loading, value: boolean) {
    setLoading((current) => ({ ...current, [key]: value }));
  }

  const {
    connections, setConnections, activeConnectionId, setActiveConnectionId,
    connectionDraft, setConnectionDraft, showConnectionModal, setShowConnectionModal,
    databases, setDatabases, saveConnection, deleteConnection, editConnection, testConnection, startNewConnection
  } = useConnections({ api, emptyConnection, driverLabel, setNotice, setLoadingFlag: (k, v) => setLoadingFlag(k as 'connection', v) });

  const {
    settings, setSettings, settingsLoaded, setSettingsLoaded,
    aiDraft, setAiDraft, saveAiProvider, testAiProvider, setDefaultProvider, deleteAiProvider, saveTheme
  } = useSettings({ api, emptyAiProvider, setNotice, setLoadingFlag: (k, v) => setLoadingFlag(k as 'settings', v) });

  const activeConnection = connections.find((c) => c.id === activeConnectionId) ?? connections[0];

  const {
    schemaMap, selectedDbs, setSelectedDbs, expandedDbs, searchQuery, dbFilter, selectedTable,
    databases: _dbs, showDbSelector, setSearchQuery, setDbFilter, setSelectedTable, setShowDbSelector,
    toggleDb, toggleExpandDb, refreshDbSchema, refreshAllSchemas,
    allTables, selectedSchema, selectedSchemaDb, dbTreeFiltered, filteredDatabases, saveSelectedDbs
  } = useSchema({ api, activeConnection, activeConnectionId, settings, setSettings, settingsLoaded, setNotice });

  if (databases.length === 0 && _dbs.length > 0) { /* migrate - databases now from useConnections */ }

  const {
    workTabs, setWorkTabs, activeWorkTabId, setActiveWorkTabId, queryHistory,
    updateWorkTab, updateActiveWorkTab, closeWorkTab,
    buildTableBaseSql, runWorkTabQuery, openTableTab, clearHistory
  } = useWorkTabs({ api, activeConnectionId, selectedDbs, setNotice, setLoadingFlag: (k, v) => setLoadingFlag(k as 'query', v),
    setPendingEdits: () => {}, setActiveInlineEditor: () => {} });

  const activeWorkTab = workTabs.find((t) => t.id === activeWorkTabId) ?? workTabs[0];
  const activeSql = activeWorkTab?.sql ?? seedSql;
  const activeResult = activeWorkTab?.result ?? null;
  const activeResultTab = activeWorkTab?.resultTab ?? 'results';
  const defaultProvider = settings.aiProviders.find((p) => p.id === settings.defaultAiProviderId) ?? settings.aiProviders[0];
  const activeTableSchema = useMemo(() => {
    if (!activeWorkTab?.dbName || !activeWorkTab.tableName) return undefined;
    return schemaMap[activeWorkTab.dbName]?.find((t) => t.name === activeWorkTab.tableName);
  }, [activeWorkTab?.dbName, activeWorkTab?.tableName, schemaMap]);

  function getCellEditBlockReason(row: Record<string, unknown>, column: string): string | null {
    if (!activeConnection) return '请先选择连接';
    if (activeConnection.driver !== 'mysql') return '当前仅 MySQL 支持编辑数据';
    if (activeConnection.readonly) return '当前连接为只读模式';
    if (activeWorkTab?.kind !== 'table' || !activeWorkTab.dbName || !activeWorkTab.tableName) return '普通 SQL 结果集暂不支持编辑';
    if (!activeTableSchema) return '未找到当前表结构';
    if (activeTableSchema.type === 'view') return '视图暂不支持编辑';
    const pks = activeTableSchema.columns.filter((c) => c.primary);
    if (!pks.length) return '表没有主键，无法安全定位行';
    if (pks.some((c) => !(c.name in row))) return '结果集中缺少主键列，无法安全定位行';
    if (pks.some((c) => c.name === column)) return '主键列暂不支持直接编辑';
    return null;
  }

  const {
    activeInlineEditor, setActiveInlineEditor, pendingEdits, setPendingEdits, pendingEditsMap,
    pendingSqlConfirm, setPendingSqlConfirm, beginCellEdit, finishCellEdit,
    undoEdit, undoAllEdits, saveBatchEdits
  } = useBatchEdit({ api, activeConnectionId, activeResult,
    dbName: activeWorkTab?.dbName, tableName: activeWorkTab?.tableName, tableSchema: activeTableSchema,
    setLoadingFlag: (k, v) => setLoadingFlag(k as 'query', v), setNotice,
    onRefreshResult: () => runWorkTabQuery(activeWorkTabId), getCellEditBlockReason });

  const {
    aiInput, setAiInput, chat, setChat, textareaRef, mentionQuery, mentionIndex,
    mentionedTables, mentionOptions, handleAiChange, selectMention, handleAiKeyDown,
    generateSql, insertTableSelect, insertTableCount, loadTableDdl
  } = useAiAssistant({ api, allTables, schemaMap, selectedSchema, selectedSchemaDb, selectedTable: selectedTable,
    activeConnection, activeConnectionId, defaultProvider,
    setLoadingFlag: (k, v) => setLoadingFlag(k as 'ai', v), setNotice, updateActiveWorkTab, mysqlTableRef });

  const runQuery = () => runWorkTabQuery();
  const browseTable = () => {
    if (!selectedSchema) { setNotice('请先选择一张表。'); return; }
    openTableTab(selectedSchemaDb ?? selectedDbs[0] ?? activeConnection?.database ?? '', selectedSchema);
  };

  const workspaceRef = useRef<HTMLDivElement>(null);

  function startSideResize(target: 'sidebar' | 'ai-panel', initialSize: number, e: React.MouseEvent) {
    e.preventDefault(); const startX = e.clientX;
    function onMove(ev: MouseEvent) { const delta = ev.clientX - startX; if (target === 'sidebar') setSidebarWidth(Math.max(180, Math.min(460, initialSize + delta))); else setAiPanelWidth(Math.max(240, Math.min(600, initialSize - delta))); }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }

  function startVerticalResize(e: React.MouseEvent) {
    e.preventDefault(); const el = workspaceRef.current; if (!el) return;
    const rect = el.getBoundingClientRect(); const startY = e.clientY; const initialH = editorHeightPx ?? Math.round(rect.height * 0.5);
    function onMove(ev: MouseEvent) { setEditorHeightPx(Math.max(120, Math.min(rect.height - 160, initialH + ev.clientY - startY))); }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); }
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  }

  function composeSortedSql(tab: WorkTab, sort = tab.sort) {
    const orderClause = sort ? `\nORDER BY ${quoteMysqlIdentifier(sort.column)} ${sort.direction.toUpperCase()}` : '';
    if (tab.kind === 'table' && tab.tableName) return `${stripTrailingSemicolon(tab.baseSql)}${orderClause}\nLIMIT 100;`;
    return `SELECT *\nFROM (\n${stripTrailingSemicolon(tab.baseSql || tab.sql)}\n) q${orderClause}\nLIMIT 100;`;
  }

  function setColumnSort(column: string) {
    if (!activeWorkTab) return;
    const current = activeWorkTab.sort;
    const nextSort = current?.column === column && current.direction === 'asc' ? { column, direction: 'desc' as const }
      : current?.column === column && current.direction === 'desc' ? undefined : { column, direction: 'asc' as const };
    updateActiveWorkTab({ sort: nextSort, sql: composeSortedSql(activeWorkTab, nextSort) });
    setNotice(nextSort ? `已按 ${column} ${nextSort.direction === 'asc' ? '升序' : '降序'} 更新 SQL` : `已取消 ${column} 排序`);
    runWorkTabQuery(activeWorkTabId, composeSortedSql(activeWorkTab, nextSort));
  }

  function exportResult(format: 'csv' | 'json') {
    if (!activeResult) { setNotice('没有可导出的结果集。'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `dbmind-result-${stamp}.${format}`;
    const content = format === 'json' ? JSON.stringify(activeResult.rows, null, 2)
      : [activeResult.columns.join(','), ...activeResult.rows.map((row) => activeResult.columns.map((col) => {
          const v = row[col] === null || row[col] === undefined ? '' : String(row[col]);
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        }).join(','))].join('\n');
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    setNotice(`已导出 ${filename}`);
  }

  return (
    <div className={`app-shell theme-${settings.theme ?? 'dark'}`} style={{ gridTemplateColumns: `72px ${sidebarWidth}px ${aiCollapsed ? 'minmax(720px, 1fr)' : 'minmax(640px, 1fr)'} ${aiCollapsed ? 56 : aiPanelWidth}px` }}>
      <LeftRail
        view={view}
        aiCollapsed={aiCollapsed}
        onNavigate={setView}
        onToggleAi={() => { setView('workspace'); setAiCollapsed((value) => !value); }}
      />

      {view === 'settings' ? (
        <SettingsView
          aiDraft={aiDraft}
          settings={settings}
          notice={notice}
          onChange={setAiDraft}
          onSave={saveAiProvider}
          onTest={testAiProvider}
          onDefault={setDefaultProvider}
          onEdit={setAiDraft}
          onDelete={deleteAiProvider}
          onThemeChange={saveTheme}
          loading={loading.settings}
        />
      ) : (
        <>
          <aside className="sidebar">
            <div className="panel-head">
              <div>
                <p>连接</p>
                <strong>{activeConnection?.name ?? '未连接'}</strong>
              </div>
              <button className="icon-btn" title="新建连接" onClick={startNewConnection}><Plus size={16} /></button>
            </div>

            <div className="connection-list">
              {connections.length === 0 ? (
                <button className="sidebar-empty-action" onClick={startNewConnection}>
                  <Plus size={15} />
                  新建连接
                </button>
              ) : connections.map((connection) => (
                <div className={`connection-item ${connection.id === activeConnectionId ? 'active' : ''}`} key={connection.id}>
                  <button className="connection-main" onClick={() => setActiveConnectionId(connection.id)}>
                    <Database size={15} />
                    <span>{connection.name}</span>
                    <em>{driverLabel(connection.driver)}</em>
                  </button>
                  <div className="row-actions">
                    <button title="编辑连接" onClick={() => editConnection(connection)}><Edit3 size={13} /></button>
                    <button title="删除连接" onClick={() => deleteConnection(connection.id)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>

            <div className="object-browser">
              <div className="section-title-row">
                <div className="section-label">对象</div>
              </div>
              {activeConnection?.driver === 'mysql' && databases.length > 0 && (
                <div className="db-multi-select">
                  <button
                    className="db-selector-head"
                    onClick={() => setShowDbSelector((v) => !v)}
                  >
                    <ChevronDown size={14} className={`tree-chevron ${showDbSelector ? '' : 'open'}`} />
                    <Database size={14} />
                    <span>{selectedDbs.length ? `已选 ${selectedDbs.length} 个库` : '选择数据库'}</span>
                    <span className="tiny-btn" onClick={(e) => { e.stopPropagation(); refreshAllSchemas(); }} title="刷新 Schema"><RefreshCw size={13} /></span>
                  </button>
                  {selectedDbs.length > 0 && !showDbSelector && (
                    <div className="db-selected-chips">
                      {selectedDbs.slice(0, 3).map((dbName) => <span key={dbName}>{dbName}</span>)}
                      {selectedDbs.length > 3 && <em>+{selectedDbs.length - 3}</em>}
                    </div>
                  )}
                  {showDbSelector && (
                    <div className="db-multi-dropdown">
                      <div className="db-filter">
                        <Search size={13} />
                        <input
                          placeholder="筛选数据库"
                          value={dbFilter}
                          onChange={(event) => setDbFilter(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                        />
                        {selectedDbs.length > 0 && (
                          <button onClick={() => { setSelectedDbs([]); if (activeConnectionId) saveSelectedDbs(activeConnectionId, []).catch(() => setNotice('数据库选择保存失败')); }}>清空</button>
                        )}
                      </div>
                      <div className="db-option-list">
                      {filteredDatabases.map((db) => (
                        <label key={db.name} className="db-check-row">
                          <input
                            type="checkbox"
                            checked={selectedDbs.includes(db.name)}
                            onChange={() => toggleDb(db.name)}
                          />
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
                <input
                  placeholder="搜索对象"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                />
                {searchQuery && (
                  <button className="search-clear" onClick={() => setSearchQuery('')}>✕</button>
                )}
              </div>
              {selectedDbs.length === 0 && !searchQuery && (
                <div className="tree-empty">{activeConnection ? '选择数据库以浏览对象' : '先新建连接'}</div>
              )}
              {selectedDbs.map((dbName) => {
                const tables = searchQuery ? (dbTreeFiltered?.[dbName] ?? []) : schemaMap[dbName];
                if (!tables || tables.length === 0) return null;
                return (
                  <div key={dbName} className="tree-group">
                    <button
                      className="tree-group-head db-root"
                      onClick={() => toggleExpandDb(dbName)}
                    >
                      <ChevronDown size={14} className={`tree-chevron ${expandedDbs.has(dbName) ? '' : 'open'}`} />
                      <Database size={14} />
                      <span>{dbName}</span>
                      <em>{tables.length}</em>
                    </button>
                    {expandedDbs.has(dbName) && tables.map((table) => (
                      <button
                        className={`table-item ${table.name === selectedTable ? 'active' : ''} ${mentionedTables.includes(table.name) ? 'mentioned' : ''}`}
                        key={table.name}
                        onClick={() => setSelectedTable(table.name)}
                        onDoubleClick={() => openTableTab(dbName, table)}
                      >
                        <Table2 size={15} />
                        <span>{table.name}</span>
                        <em>{table.columns.length}</em>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="resize-handle-col" onMouseDown={(e) => startSideResize('sidebar', sidebarWidth, e)} />
          </aside>

          <main className="workspace" ref={workspaceRef}>
            <TopBar
              workTab={activeWorkTab}
              connection={activeConnection}
              selectedDbsCount={selectedDbs.length}
              tableCount={allTables.length}
              defaultProvider={defaultProvider}
              dbName={activeWorkTab?.dbName}
              tableName={activeWorkTab?.tableName}
              queryLoading={loading.query}
              aiLoading={loading.ai}
              onRunQuery={runQuery}
              onAiGenerate={generateSql}
              onDesignTable={() => {
                if (activeWorkTab?.dbName && activeWorkTab.tableName) {
                  setTableDesignerTarget({ database: activeWorkTab.dbName, table: activeWorkTab.tableName });
                }
              }}
            />
            <WorkTabStrip
              workTabs={workTabs}
              activeWorkTabId={activeWorkTabId}
              onSelectTab={setActiveWorkTabId}
              onCloseTab={closeWorkTab}
            />

            <section className="editor-zone" style={editorHeightPx ? { flex: `0 0 ${editorHeightPx}px` } : { flex: '1 1 50%' }}>
              <div className="editor-toolbar">
                <span>{activeWorkTab?.kind === 'table' && activeWorkTab.dbName ? `${activeWorkTab.dbName}.${activeWorkTab.tableName}` : 'SQL Console'}</span>
                <span>{notice || 'Ready'}</span>
              </div>
              <SqlEditor
                value={activeSql}
                onChange={(newValue) => updateActiveWorkTab({ baseSql: newValue, sql: newValue, sort: undefined })}
                schemaMap={schemaMap}
                selectedDbs={selectedDbs}
                currentDb={activeWorkTab?.dbName ?? (selectedDbs.length === 1 ? selectedDbs[0] : undefined)}
              />
            </section>

            <div className="resize-handle-row" onMouseDown={startVerticalResize} />

            <section className="result-zone" style={{ flex: '1 1 50%', minHeight: 0 }}>
              <div className="tabs">
                <button className={activeResultTab === 'results' ? 'active' : ''} onClick={() => updateActiveWorkTab({ resultTab: 'results' })}>结果集</button>
                <button className={activeResultTab === 'history' ? 'active' : ''} onClick={() => updateActiveWorkTab({ resultTab: 'history' })}>查询历史</button>
                <button onClick={() => exportResult('csv')}>CSV</button>
                <button onClick={() => exportResult('json')}>JSON</button>
                <span>{activeResult ? `${activeResult.rowCount} rows · ${activeResult.durationMs}ms` : '尚未执行'}</span>
              </div>
              {pendingEdits.length > 0 && activeResultTab === 'results' && (
                <div className="batch-edit-toolbar">
                  <div className="batch-edit-header">
                    <span className="batch-edit-count">
                      <Edit3 size={14} />
                      {pendingEdits.length} 处修改
                    </span>
                    <div className="batch-edit-header-actions">
                      <button className="ghost" onClick={undoAllEdits} title="撤销所有修改">
                        <Trash2 size={13} /> 全部撤销
                      </button>
                      <button className="primary" onClick={saveBatchEdits} disabled={loading.query}>
                        <Save size={14} /> {loading.query ? '保存中' : '保存'}
                      </button>
                    </div>
                  </div>
                  <div className="batch-edit-list">
                    {pendingEdits.map((edit) => (
                      <div className="batch-edit-item" key={`${edit.rowIndex}:${edit.column}`}>
                        <span className="batch-edit-col">{edit.column}</span>
                        <span className="batch-edit-old">{edit.originalValue || 'NULL'}</span>
                        <span className="batch-edit-arrow">&rarr;</span>
                        <span className="batch-edit-new">{edit.asNull ? 'NULL' : edit.newValue}</span>
                        <button
                          className="batch-edit-undo"
                          onClick={() => undoEdit(edit.rowIndex, edit.column)}
                          title="撤销此修改"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="table-wrap">
                {loading.query && (
                  <div className="loading-overlay">
                    <span className="spinner" />
                    查询执行中...
                  </div>
                )}
                {activeResultTab === 'history' ? (
                  <HistoryPanel history={queryHistory} onUseSql={(nextSql) => updateActiveWorkTab({ baseSql: nextSql, sql: nextSql, sort: undefined })} onClear={clearHistory} />
                ) : activeResult ? (
                  <table>
                    <thead>
                      <tr>
                        {activeResult.columns.map((column) => (
                          <th key={column}>
                            <button className={`column-sort ${activeWorkTab?.sort?.column === column ? 'active' : ''}`} onClick={() => setColumnSort(column)}>
                              <span>{column}</span>
                              <em>{activeWorkTab?.sort?.column === column ? (activeWorkTab.sort.direction === 'asc' ? '↑' : '↓') : '↕'}</em>
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeResult.rows.map((row, index) => (
                        <tr key={index}>
                          {activeResult.columns.map((column) => {
                            const reason = getCellEditBlockReason(row, column);
                            const isInlineEditing = activeInlineEditor?.rowIndex === index && activeInlineEditor.column === column;
                            const pendingKey = `${index}:${column}`;
                            const pendingEdit = pendingEditsMap.get(pendingKey);
                            const tdClass = [
                              reason ? 'cell-readonly' : 'cell-editable',
                              pendingEdit ? 'cell-edited' : ''
                            ].filter(Boolean).join(' ');
                            const displayValue = pendingEdit
                              ? (pendingEdit.asNull ? 'NULL' : pendingEdit.newValue)
                              : formatValue(row[column]);
                            const isNullDisplay = pendingEdit?.asNull;
                            return (
                              <td
                                key={column}
                                className={tdClass}
                                title={reason ?? (pendingEdit ? '已修改，双击重新编辑' : '双击编辑')}
                                onDoubleClick={() => beginCellEdit(index, row, column)}
                              >
                                {isInlineEditing ? (
                                  <div className="cell-editor-wrap">
                                    <input
                                      className="cell-editor"
                                      autoFocus
                                      value={activeInlineEditor!.value}
                                      placeholder={activeInlineEditor!.asNull ? 'NULL' : ''}
                                      onChange={(event) => setActiveInlineEditor({ ...activeInlineEditor!, value: event.target.value, asNull: false })}
                                      onBlur={() => finishCellEdit(activeInlineEditor!)}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault();
                                          event.currentTarget.blur();
                                        }
                                        if (event.key === 'Escape') {
                                          event.preventDefault();
                                          setActiveInlineEditor(null);
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => finishCellEdit({ ...activeInlineEditor!, value: '', asNull: true })}
                                      title="保存为 NULL"
                                    >
                                      NULL
                                    </button>
                                  </div>
                                ) : (
                                  <span className={isNullDisplay ? 'cell-edited-null' : ''}>{displayValue}</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state workspace-empty">
                    {!activeConnection ? (
                      <>
                        <Database size={24} />
                        <strong>连接数据库后开始工作</strong>
                        <span>保存 MySQL 或 PostgreSQL 连接后，表结构、SQL 和结果集会在这里联动。</span>
                        <button className="run-btn" onClick={startNewConnection}><Plus size={15} /> 新建连接</button>
                      </>
                    ) : (
                      '执行 SQL 后，结果会显示在这里。'
                    )}
                  </div>
                )}
              </div>
            </section>
          </main>
          <AiPanel
            aiPanelWidth={aiPanelWidth}
            collapsed={aiCollapsed}
            onToggleCollapsed={() => setAiCollapsed((value) => !value)}
            onStartResize={startSideResize}
            selectedSchema={selectedSchema}
            chat={chat}
            aiInput={aiInput}
            mentionedTables={mentionedTables}
            busy={busy}
            aiLoading={loading.ai}
            textareaRef={textareaRef}
            mentionQuery={mentionQuery}
            mentionOptions={mentionOptions}
            mentionIndex={mentionIndex}
            onInput={handleAiChange}
            onKeyDown={handleAiKeyDown}
            onSelectMention={selectMention}
            onGenerate={generateSql}
            onSelectTemplate={() => insertTableSelect(100)}
            onCountTemplate={insertTableCount}
            onLoadDdl={loadTableDdl}
            onBrowseTable={browseTable}
            onDesignTable={() => {
              if (!selectedSchema) return;
              setTableDesignerTarget({ database: selectedSchemaDb ?? selectedDbs[0] ?? activeConnection?.database ?? '', table: selectedSchema.name });
            }}
            onClear={() => setChat([])}
          />
        </>
      )}

      <ConnectionModal
        open={showConnectionModal}
        connectionDraft={connectionDraft}
        databases={databases}
        loading={loading.connection}
        onClose={() => setShowConnectionModal(false)}
        onChange={setConnectionDraft}
        onSave={saveConnection}
        onTest={testConnection}
      />

      <SqlConfirmModal data={pendingSqlConfirm} loading={loading.query} onClose={() => setPendingSqlConfirm(null)} />

      {tableDesignerTarget && activeConnectionId && (
        <TableDesignerModal
          api={api}
          connectionId={activeConnectionId}
          target={tableDesignerTarget}
          loading={loading.query}
          onLoading={(value) => setLoadingFlag('query', value)}
          onNotice={setNotice}
          onClose={() => setTableDesignerTarget(null)}
          onApplied={async () => {
            await refreshDbSchema(tableDesignerTarget.database);
            if (activeWorkTab?.kind === 'table' && activeWorkTab.dbName === tableDesignerTarget.database && activeWorkTab.tableName === tableDesignerTarget.table) {
              await runWorkTabQuery(activeWorkTabId);
            }
          }}
        />
      )}
    </div>
  );
}

