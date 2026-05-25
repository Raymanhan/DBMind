import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Braces, Clock3, Database, Download, Edit3, FileSpreadsheet, Plus, Rows3, Save, Sparkles, Trash2} from 'lucide-react';
import type {AiConversation, AiProviderConfig, ChatMessage, DbConnectionConfig, DbmindApi, WorkTab} from '../shared/types';
import {AiPanel} from './components/ai/AiPanel';
import {ConnectionModal} from './components/connection/ConnectionModal';
import {SqlEditor} from './components/editor/SqlEditor';
import {SqlConfirmModal} from './components/modals/SqlConfirmModal';

import {EditableCell} from './components/result/EditableCell';
import {HistoryPanel} from './components/result/HistoryPanel';
import {Sidebar} from './components/sidebar/Sidebar';
import {TableDesignerModal} from './components/schema/TableDesigner';
import {TopBar} from './components/workspace/TopBar';
import {WorkTabStrip} from './components/workspace/WorkTabStrip';
import {SettingsView} from './components/settings/SettingsView';
import {useBatchEdit} from './hooks/useBatchEdit';
import {useConnections} from './hooks/useConnections';
import {useSettings} from './hooks/useSettings';
import {useSchema} from './hooks/useSchema';
import {useWorkTabs} from './hooks/useWorkTabs';
import {useAiAssistant} from './hooks/useAiAssistant';
import {browserFallbackApi} from './browserApi';
import {mysqlTableRef, quoteMysqlIdentifier} from '../shared/sql/identifiers';

type AppView = 'workspace' | 'settings';
type BatchCellEdit = {
    rowIndex: number;
    column: string;
    newValue: string;
    originalValue: string;
    asNull: boolean;
};

const api: DbmindApi = window.dbmind ?? browserFallbackApi;
const isIntegratedMacWindow = Boolean(window.dbmind) && /Mac/.test(navigator.platform);

const seedSql = `SELECT 1 AS connected;`;
const RESULT_ZONE_STYLE = {flex: '1 1 70%', minHeight: 0} as const;

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
    if (typeof value === 'number') return String(value);
    return String(value);
}

function driverLabel(driver: string): string {
    return driver === 'postgres' ? 'PostgreSQL' : 'MySQL';
}

function providerLabel(provider: AiProviderConfig): string {
    return `${provider.name || provider.provider} · ${provider.apiMode}`;
}

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
    const [settingsInitialTab, setSettingsInitialTab] = useState<'general' | 'ai'>('general');
    const [sidebarWidth, setSidebarWidth] = useState(260);
    const [aiPanelWidth, setAiPanelWidth] = useState(300);
    const [aiCollapsed, setAiCollapsed] = useState(() => window.innerWidth < 1360);
    const [editorHeightPx, setEditorHeightPx] = useState<number | null>(null);
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState({query: false, ai: false, connection: false, settings: false});
    const busy = loading.query || loading.ai || loading.connection || loading.settings;
    const [tableDesignerTarget, setTableDesignerTarget] = useState<{ database: string; table: string } | null>(null);

    const setLoadingFlag = useCallback((key: keyof typeof loading, value: boolean) => {
        setLoading((current) => ({...current, [key]: value}));
    }, []);
    const setQueryLoading = useCallback((k: string, v: boolean) => setLoadingFlag(k as 'query', v), [setLoadingFlag]);
    const setAiLoading = useCallback((k: string, v: boolean) => setLoadingFlag(k as 'ai', v), [setLoadingFlag]);
    const setConnectionLoading = useCallback((k: string, v: boolean) => setLoadingFlag(k as 'connection', v), [setLoadingFlag]);
    const setSettingsLoading = useCallback((k: string, v: boolean) => setLoadingFlag(k as 'settings', v), [setLoadingFlag]);

    const {
        connections, setConnections, activeConnectionId, setActiveConnectionId,
        connectionDraft, setConnectionDraft, showConnectionModal, setShowConnectionModal,
        databases: connectionDatabases,
        saveConnection, deleteConnection, editConnection, testConnection, startNewConnection
    } = useConnections({
        api,
        emptyConnection,
        driverLabel,
        setNotice,
        setLoadingFlag: setConnectionLoading
    });

    const {
        settings, setSettings, settingsLoaded, setSettingsLoaded,
        aiDraft, setAiDraft, saveAiProvider, testAiProvider, setDefaultProvider, deleteAiProvider, saveTheme
    } = useSettings({api, emptyAiProvider, setNotice, setLoadingFlag: setSettingsLoading});

    const activeConnection = connections.find((c) => c.id === activeConnectionId) ?? connections[0];

    const {
        schemaMap, selectedDbs, setSelectedDbs, expandedDbs, searchQuery, dbFilter, selectedTable,
        databases: schemaDatabases, showDbSelector, setSearchQuery, setDbFilter, setSelectedTable, setShowDbSelector,
        toggleDb, toggleExpandDb, refreshDbSchema, refreshAllSchemas,
        allTables, selectedSchema, selectedSchemaDb, dbTreeFiltered, filteredDatabases, saveSelectedDbs
    } = useSchema({api, activeConnection, activeConnectionId, settings, setSettings, settingsLoaded, setNotice});

    const {
        workTabs, setWorkTabs, activeWorkTabId, setActiveWorkTabId, queryHistory,
        updateWorkTab, updateActiveWorkTab, closeWorkTab,
        buildTableBaseSql, runWorkTabQuery, openTableTab, clearHistory
    } = useWorkTabs({
        api,
        activeConnectionId,
        selectedDbs,
        setNotice,
        setLoadingFlag: setQueryLoading
    });

    const activeWorkTab = workTabs.find((t) => t.id === activeWorkTabId) ?? workTabs[0];
    const activeSql = activeWorkTab?.sql ?? seedSql;
    const activeResult = activeWorkTab?.result ?? null;
    const activeResultTab = activeWorkTab?.resultTab ?? 'results';
    const availableDatabaseNames = useMemo(() => schemaDatabases.map((db) => db.name), [schemaDatabases]);
    const defaultProvider = settings.aiProviders.find((p) => p.id === settings.defaultAiProviderId) ?? settings.aiProviders[0];
    const activeTableSchema = useMemo(() => {
        if (!activeWorkTab?.dbName || !activeWorkTab.tableName) return undefined;
        return schemaMap[activeWorkTab.dbName]?.find((t) => t.name === activeWorkTab.tableName);
    }, [activeWorkTab?.dbName, activeWorkTab?.tableName, schemaMap]);
    const activeColumnSchemaMap = useMemo(() => {
        return new Map(activeTableSchema?.columns.map((column) => [column.name, column]) ?? []);
    }, [activeTableSchema]);

    const getCellEditBlockReason = useCallback((row: Record<string, unknown>, column: string): string | null => {
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
    }, [activeConnection, activeWorkTab, activeTableSchema]);

    const {
        activeInlineEditor, setActiveInlineEditor, pendingEdits, setPendingEdits, pendingEditsMap,
        pendingSqlConfirm, setPendingSqlConfirm, beginCellEdit, finishCellEdit,
        undoEdit, undoAllEdits, saveBatchEdits
    } = useBatchEdit({
        api, activeConnectionId, activeResult,
        dbName: activeWorkTab?.dbName, tableName: activeWorkTab?.tableName, tableSchema: activeTableSchema,
        setLoadingFlag: setQueryLoading, setNotice,
        onRefreshResult: () => runWorkTabQuery(activeWorkTabId), getCellEditBlockReason
    });

    // Clear pending edits when switching to a different tab
    useEffect(() => {
        setPendingEdits([]);
        setActiveInlineEditor(null);
    }, [activeWorkTabId]);

    const {
        aiInput, setAiInput, activeMessages, textareaRef, mentionQuery, mentionIndex,
        mentionedTables, mentionOptions, handleAiChange, selectMention, handleAiKeyDown,
        generateSql, insertTableSelect, insertTableCount, loadTableDdl,
        conversations, activeConversationId,
        createConversation, switchConversation, deleteConversation, clearAllConversations
    } = useAiAssistant({
        api, allTables, schemaMap, selectedSchema, selectedSchemaDb, selectedTable: selectedTable,
        activeConnection, activeConnectionId, defaultProvider,
        setLoadingFlag: setAiLoading, setNotice, updateActiveWorkTab, mysqlTableRef
    });

    const handleSqlChange = useCallback((newValue: string) => {
        updateActiveWorkTab({ baseSql: newValue, sql: newValue, sort: undefined });
    }, [updateActiveWorkTab]);
    const runQuery = useCallback((sqlOverride?: string) => {
        setPendingEdits([]);
        setActiveInlineEditor(null);
        return runWorkTabQuery(activeWorkTabId, sqlOverride);
    }, [runWorkTabQuery, activeWorkTabId]);

    // Stable callbacks for Sidebar / AiPanel / modals
    const toggleDbSelector = useCallback(() => setShowDbSelector((v) => !v), []);
    const clearSearch = useCallback(() => setSearchQuery(''), []);
    const clearSelection = useCallback(() => {
        setSelectedDbs([]);
        if (activeConnectionId) saveSelectedDbs(activeConnectionId, []).catch(() => setNotice('数据库选择保存失败'));
    }, [activeConnectionId, saveSelectedDbs, setNotice]);
    const navigateTo = useCallback((v: string) => setView(v as AppView), []);
    const toggleAiCollapsed = useCallback(() => { setView('workspace'); setAiCollapsed((v) => !v); }, []);
    const toggleAiPanelCollapsed = useCallback(() => setAiCollapsed((v) => !v), []);
    const selectTableTemplate = useCallback(() => insertTableSelect(100), [insertTableSelect]);
    const designSelectedTable = useCallback(() => {
        if (!selectedSchema) return;
        setTableDesignerTarget({
            database: selectedSchemaDb ?? selectedDbs[0] ?? activeConnection?.database ?? '',
            table: selectedSchema.name
        });
    }, [selectedSchema, selectedSchemaDb, selectedDbs, activeConnection]);
    const designActiveTable = useCallback(() => {
        if (activeWorkTab?.dbName && activeWorkTab.tableName) {
            setTableDesignerTarget({ database: activeWorkTab.dbName, table: activeWorkTab.tableName });
        }
    }, [activeWorkTab?.dbName, activeWorkTab?.tableName]);
    const navigateToAiSettings = useCallback(() => {
        setSettingsInitialTab('ai');
        setView('settings');
    }, []);
    const closeConnectionModal = useCallback(() => setShowConnectionModal(false), []);
    const closeTableDesigner = useCallback(() => setTableDesignerTarget(null), []);
    const browseTable = useCallback(() => {
        if (!selectedSchema) {
            setNotice('请先选择一张表。');
            return;
        }
        openTableTab(selectedSchemaDb ?? selectedDbs[0] ?? activeConnection?.database ?? '', selectedSchema);
    }, [selectedSchema, selectedSchemaDb, selectedDbs, activeConnection, openTableTab, setNotice]);

    const workspaceRef = useRef<HTMLDivElement>(null);

    function startSideResize(target: 'sidebar' | 'ai-panel', initialSize: number, e: React.MouseEvent) {
        e.preventDefault();
        const startX = e.clientX;

        function onMove(ev: MouseEvent) {
            const delta = ev.clientX - startX;
            if (target === 'sidebar') setSidebarWidth(Math.max(180, Math.min(460, initialSize + delta))); else setAiPanelWidth(Math.max(240, Math.min(600, initialSize - delta)));
        }

        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    function startVerticalResize(e: React.MouseEvent) {
        e.preventDefault();
        const el = workspaceRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const startY = e.clientY;
        const initialH = editorHeightPx ?? Math.round(rect.height * 0.3);

        function onMove(ev: MouseEvent) {
            setEditorHeightPx(Math.max(120, Math.min(rect.height - 160, initialH + ev.clientY - startY)));
        }

        function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }

    function composeSortedSql(tab: WorkTab, sort = tab.sort) {
        const orderClause = sort ? `\nORDER BY ${quoteMysqlIdentifier(sort.column)} ${sort.direction.toUpperCase()}` : '';
        if (tab.kind === 'table' && tab.tableName) return `${stripTrailingSemicolon(tab.baseSql)}${orderClause}\nLIMIT 100;`;
        return `SELECT *
                FROM (${stripTrailingSemicolon(tab.baseSql || tab.sql)}) q${orderClause} LIMIT 100;`;
    }

    const setColumnSort = useCallback((column: string) => {
        if (!activeWorkTab) return;
        const current = activeWorkTab.sort;
        const nextSort = current?.column === column && current.direction === 'asc' ? {
                column,
                direction: 'desc' as const
            }
            : current?.column === column && current.direction === 'desc' ? undefined : {
                column,
                direction: 'asc' as const
            };
        updateActiveWorkTab({sort: nextSort, sql: composeSortedSql(activeWorkTab, nextSort)});
        setNotice(nextSort ? `已按 ${column} ${nextSort.direction === 'asc' ? '升序' : '降序'} 更新 SQL` : `已取消 ${column} 排序`);
        setPendingEdits([]);
        setActiveInlineEditor(null);
        runWorkTabQuery(activeWorkTabId, composeSortedSql(activeWorkTab, nextSort));
    }, [activeWorkTab, updateActiveWorkTab, setNotice, runWorkTabQuery, activeWorkTabId]);

    const exportResult = useCallback((format: 'csv' | 'json') => {
        if (!activeResult) {
            setNotice('没有可导出的结果集。');
            return;
        }
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `dbmind-result-${stamp}.${format}`;
        const content = format === 'json' ? JSON.stringify(activeResult.rows, null, 2)
            : [activeResult.columns.join(','), ...activeResult.rows.map((row) => activeResult.columns.map((col) => {
                const v = row[col] === null || row[col] === undefined ? '' : String(row[col]);
                return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            }).join(','))].join('\n');
        const blob = new Blob([content], {type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        setNotice(`已导出 ${filename}`);
    }, [activeResult, setNotice]);

    const copyText = useCallback(async (value: unknown, label = '内容') => {
        const text = value === null || value === undefined ? '' : String(value);
        try {
            await navigator.clipboard.writeText(text);
            setNotice(`已复制${label}`);
        } catch {
            setNotice('复制失败');
        }
    }, [setNotice]);

    const visibleRows = useMemo(() => activeResult?.rows.slice(0, 1000) ?? [], [activeResult]);
    const isResultTruncated = Boolean(activeResult && activeResult.rows.length > visibleRows.length);

    const resultTableBody = useMemo(() => {
      if (!activeResult) return null;
      return visibleRows.map((row, index) => (
        <tr key={index}>
          <td className="row-index-cell">{index + 1}</td>
          {activeResult.columns.map((column) => {
            const reason = getCellEditBlockReason(row, column);
            const pendingKey = `${index}:${column}`;
            const pendingEdit = pendingEditsMap.get(pendingKey);
            const displayValue = pendingEdit
              ? (pendingEdit.asNull ? 'NULL' : pendingEdit.newValue)
              : formatValue(row[column]);
            return (
              <EditableCell
                key={column}
                rowIndex={index}
                column={column}
                value={row[column]}
                reason={reason}
                columnSchema={activeColumnSchemaMap.get(column)}
                pendingEdit={pendingEdit}
                editorState={activeInlineEditor}
                displayValue={displayValue}
                isNullDisplay={Boolean(pendingEdit?.asNull)}
                onBeginEdit={() => beginCellEdit(index, row, column)}
                onEditorChange={setActiveInlineEditor}
                onCommit={finishCellEdit}
                onCancel={() => setActiveInlineEditor(null)}
                onCopy={() => copyText(row[column], '单元格')}
              />
            );
          })}
        </tr>
      ));
    }, [visibleRows, activeResult, pendingEditsMap, activeColumnSchemaMap, activeInlineEditor, getCellEditBlockReason, beginCellEdit, setActiveInlineEditor, finishCellEdit, copyText, formatValue]);

    const gridStyle = useMemo(() => ({
      gridTemplateColumns: `${sidebarWidth}px ${aiCollapsed ? 'minmax(720px, 1fr)' : 'minmax(640px, 1fr)'} ${aiCollapsed ? 56 : aiPanelWidth}px`
    }), [sidebarWidth, aiPanelWidth, aiCollapsed]);
    const editorZoneStyle = useMemo(() =>
      editorHeightPx ? {flex: `0 0 ${editorHeightPx}px`} : {flex: '1 1 30%'}
    , [editorHeightPx]);

    return (
        <div className={`app-shell theme-${settings.theme ?? 'dark'} ${isIntegratedMacWindow ? 'window-integrated' : ''}`}
             style={gridStyle}>

            {view === 'settings' ? (
                <SettingsView
                    key={`settings-${settingsInitialTab}`}
                    initialTab={settingsInitialTab}
                    aiDraft={aiDraft}
                    settings={settings}
                    notice={notice}
                    sidebarWidth={sidebarWidth}
                    onChange={setAiDraft}
                    onSave={saveAiProvider}
                    onTest={testAiProvider}
                    onDefault={setDefaultProvider}
                    onEdit={setAiDraft}
                    onDelete={deleteAiProvider}
                    onThemeChange={saveTheme}
                    onBack={() => { setView('workspace'); setSettingsInitialTab('general'); }}
                    loading={loading.settings}
                />
            ) : (
                <>
                    <Sidebar
                        activeConnection={activeConnection}
                        activeConnectionId={activeConnectionId}
                        connections={connections}
                        databases={schemaDatabases}
                        filteredDatabases={filteredDatabases}
                        selectedDbs={selectedDbs}
                        expandedDbs={expandedDbs}
                        searchQuery={searchQuery}
                        dbFilter={dbFilter}
                        showDbSelector={showDbSelector}
                        schemaMap={schemaMap}
                        dbTreeFiltered={dbTreeFiltered}
                        selectedTable={selectedTable}
                        mentionedTables={mentionedTables}
                        sidebarWidth={sidebarWidth}
                        onSelectConnection={setActiveConnectionId}
                        onNewConnection={startNewConnection}
                        onEditConnection={editConnection}
                        onDeleteConnection={deleteConnection}
                        onToggleDb={toggleDb}
                        onToggleExpandDb={toggleExpandDb}
                        onToggleDbSelector={toggleDbSelector}
                        onSearchChange={setSearchQuery}
                        onClearSearch={clearSearch}
                        onDbFilterChange={setDbFilter}
                        onClearSelection={clearSelection}
                        onRefreshSchemas={refreshAllSchemas}
                        onSelectTable={setSelectedTable}
                        onOpenTableTab={openTableTab}
                        onStartResize={startSideResize}
                        view={view}
                        aiCollapsed={aiCollapsed}
                        onNavigate={navigateTo}
                        onToggleAi={toggleAiCollapsed}
                    />

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
                            onDesignTable={designActiveTable}
                        />
                        <WorkTabStrip
                            workTabs={workTabs}
                            activeWorkTabId={activeWorkTabId}
                            onSelectTab={setActiveWorkTabId}
                            onCloseTab={closeWorkTab}
                        />

                        <section className="editor-zone" style={editorZoneStyle}>
                            <div className="editor-toolbar">
                                <span className="toolbar-status">{notice || 'Ready'}</span>
                            </div>
                            <SqlEditor
                                value={activeSql}
                                onChange={handleSqlChange}
                                onRunQuery={runQuery}
                                schemaMap={schemaMap}
                                selectedDbs={selectedDbs}
                                databaseNames={availableDatabaseNames}
                                currentDb={activeWorkTab?.dbName ?? (selectedDbs.length === 1 ? selectedDbs[0] : undefined)}
                            />
                        </section>

                        <div className="resize-handle-row" onMouseDown={startVerticalResize}/>

                        <section className="result-zone" style={RESULT_ZONE_STYLE}>
                            <div className="tabs">
                                <button className={activeResultTab === 'results' ? 'active' : ''}
                                        onClick={() => updateActiveWorkTab({resultTab: 'results'})}><Rows3 size={14}/> 结果集
                                </button>
                                <button className={activeResultTab === 'history' ? 'active' : ''}
                                        onClick={() => updateActiveWorkTab({resultTab: 'history'})}><Clock3 size={14}/> 查询历史
                                </button>
                                <button onClick={() => exportResult('csv')}><FileSpreadsheet size={14}/> CSV</button>
                                <button onClick={() => exportResult('json')}><Braces size={14}/> JSON</button>
                                <span>{activeResult ? `${activeResult.rowCount} rows · ${activeResult.durationMs}ms` : '尚未执行'}</span>
                                {isResultTruncated && <span className="result-note">仅渲染前 {visibleRows.length} 行</span>}
                                <button className="tabs-icon" onClick={() => exportResult('csv')} title="下载 CSV"><Download size={14}/></button>
                            </div>
                            {pendingEdits.length > 0 && activeResultTab === 'results' && (
                                <div className="batch-edit-toolbar">
                                    <div className="batch-edit-header">
                    <span className="batch-edit-count">
                      <Edit3 size={14}/>
                        {pendingEdits.length} 处修改
                    </span>
                                        <div className="batch-edit-header-actions">
                                            <button className="ghost" onClick={undoAllEdits} title="撤销所有修改">
                                                <Trash2 size={13}/> 全部撤销
                                            </button>
                                            <button className="primary" onClick={saveBatchEdits}
                                                    disabled={loading.query}>
                                                <Save size={14}/> {loading.query ? '保存中' : '保存'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="batch-edit-list">
                                        {pendingEdits.map((edit) => (
                                            <div className="batch-edit-item" key={`${edit.rowIndex}:${edit.column}`}>
                                                <span className="batch-edit-col">{edit.column}</span>
                                                <span className="batch-edit-old">{edit.originalValue || 'NULL'}</span>
                                                <span className="batch-edit-arrow">&rarr;</span>
                                                <span
                                                    className="batch-edit-new">{edit.asNull ? 'NULL' : edit.newValue}</span>
                                                <button
                                                    className="batch-edit-undo"
                                                    onClick={() => undoEdit(edit.rowIndex, edit.column)}
                                                    title="撤销此修改"
                                                >
                                                    <Trash2 size={12}/>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="table-wrap">
                                {loading.query && (
                                    <div className="loading-overlay">
                                        <span className="spinner"/>
                                        查询执行中...
                                    </div>
                                )}
                                {activeResultTab === 'history' ? (
                                    <HistoryPanel history={queryHistory} onUseSql={(nextSql) => updateActiveWorkTab({
                                        baseSql: nextSql,
                                        sql: nextSql,
                                        sort: undefined
                                    })} onClear={clearHistory}/>
                                ) : activeResult ? (
                                    <table>
                                        <thead>
                                        <tr>
                                            <th className="row-index-head">#</th>
                                            {activeResult.columns.map((column) => (
                                                <th key={column}>
                                                    <button
                                                        className={`column-sort ${activeWorkTab?.sort?.column === column ? 'active' : ''}`}
                                                        onClick={() => setColumnSort(column)}>
                                                        <span>{column}</span>
                                                        <em>{activeWorkTab?.sort?.column === column ? (activeWorkTab.sort.direction === 'asc' ? '↑' : '↓') : '↕'}</em>
                                                    </button>
                                                </th>
                                            ))}
                                        </tr>
                                        </thead>
                                        <tbody>{resultTableBody}</tbody>
                                    </table>
                                ) : (
                                    <div className="empty-state workspace-empty">
                                        {!activeConnection ? (
                                            <>
                                                <Database size={24}/>
                                                <strong>连接数据库后开始工作</strong>
                                                <span>保存 MySQL 或 PostgreSQL 连接后，表结构、SQL 和结果集会在这里联动。</span>
                                                <button className="run-btn" onClick={startNewConnection}><Plus
                                                    size={15}/> 新建连接
                                                </button>
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
                        chat={activeMessages}
                        aiInput={aiInput}
                        mentionedTables={mentionedTables}
                        busy={busy}
                        aiLoading={loading.ai}
                        textareaRef={textareaRef}
                        mentionQuery={mentionQuery}
                        mentionOptions={mentionOptions}
                        mentionIndex={mentionIndex}
                        conversations={conversations}
                        activeConversationId={activeConversationId}
                        onInput={handleAiChange}
                        onKeyDown={handleAiKeyDown}
                        onSelectMention={selectMention}
                        onGenerate={generateSql}
                        onSelectTemplate={selectTableTemplate}
                        onCountTemplate={insertTableCount}
                        onLoadDdl={loadTableDdl}
                        onBrowseTable={browseTable}
                        onDesignTable={designSelectedTable}
                        onCreateConversation={createConversation}
                        onSwitchConversation={switchConversation}
                        onDeleteConversation={deleteConversation}
                        onClearAllConversations={clearAllConversations}
                        onNavigateToSettings={navigateToAiSettings}
                    />
                </>
            )}

            <ConnectionModal
                open={showConnectionModal}
                connectionDraft={connectionDraft}
                databases={connectionDatabases}
                loading={loading.connection}
                onClose={closeConnectionModal}
                onChange={setConnectionDraft}
                onSave={saveConnection}
                onTest={testConnection}
            />

            <SqlConfirmModal data={pendingSqlConfirm} loading={loading.query}
                             onClose={() => setPendingSqlConfirm(null)}/>

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
                        setPendingEdits([]);
                        setActiveInlineEditor(null);
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
