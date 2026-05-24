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
import { HistoryPanel } from './components/result/HistoryPanel';
import { TableDesignerModal } from './components/schema/TableDesigner';
import { TopBar } from './components/workspace/TopBar';
import { WorkTabStrip } from './components/workspace/WorkTabStrip';
import { SettingsView } from './components/settings/SettingsView';
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
  const [connections, setConnections] = useState<DbConnectionConfig[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState('');
  const [schemaMap, setSchemaMap] = useState<Record<string, TableSchema[]>>({});
  const [selectedDbs, setSelectedDbs] = useState<string[]>([]);
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [dbFilter, setDbFilter] = useState('');
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [workTabs, setWorkTabs] = useState<WorkTab[]>([
    createConsoleTab()
  ]);
  const [activeWorkTabId, setActiveWorkTabId] = useState('console');
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState({ query: false, ai: false, connection: false, settings: false });
  const busy = loading.query || loading.ai || loading.connection || loading.settings;
  const [aiInput, setAiInput] = useState('');
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: '选择表后在输入框使用 @table 描述查询需求，我会把 SQL 生成到控制台。',
      meta: 'AI 助手 · Schema-aware'
    }
  ]);
  const [connectionDraft, setConnectionDraft] = useState<DbConnectionConfig>(emptyConnection);
  const [settings, setSettings] = useState<AppSettings>({ aiProviders: [], defaultAiProviderId: undefined, theme: 'dark', selectedDatabasesByConnection: {} });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [aiDraft, setAiDraft] = useState<AiProviderConfig>(emptyAiProvider);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<{ db: string; table: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [aiPanelWidth, setAiPanelWidth] = useState(300);
  const [aiCollapsed, setAiCollapsed] = useState(() => window.innerWidth < 1360);
  const [editorHeightPx, setEditorHeightPx] = useState<number | null>(null);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [showDbSelector, setShowDbSelector] = useState(false);
  const [notice, setNotice] = useState('');
  const [activeInlineEditor, setActiveInlineEditor] = useState<{ rowIndex: number; column: string; value: string; asNull: boolean } | null>(null);
  const [pendingEdits, setPendingEdits] = useState<BatchCellEdit[]>([]);
  const [pendingSqlConfirm, setPendingSqlConfirm] = useState<SqlConfirmData | null>(null);
  const [tableDesignerTarget, setTableDesignerTarget] = useState<{ database: string; table: string } | null>(null);

  const activeConnection = connections.find((connection) => connection.id === activeConnectionId) ?? connections[0];
  const activeWorkTab = workTabs.find((tab) => tab.id === activeWorkTabId) ?? workTabs[0];
  const activeSql = activeWorkTab?.sql ?? seedSql;
  const activeResult = activeWorkTab?.result ?? null;
  const activeResultTab = activeWorkTab?.resultTab ?? 'results';
  const allTables = useMemo(() => Object.values(schemaMap).flat(), [schemaMap]);
  const selectedSchema = allTables.find((table) => table.name === selectedTable);
  const selectedSchemaDb = useMemo(() => {
    if (!selectedTable) return undefined;
    for (const [db, tables] of Object.entries(schemaMap)) {
      if (tables.some((t) => t.name === selectedTable)) return db;
    }
    return undefined;
  }, [selectedTable, schemaMap]);
  const mentionedTables = useMemo(() => extractTableMentions(aiInput), [aiInput]);
  const defaultProvider = settings.aiProviders.find((provider) => provider.id === settings.defaultAiProviderId) ?? settings.aiProviders[0];
  const activeTableSchema = useMemo(() => {
    if (!activeWorkTab?.dbName || !activeWorkTab.tableName) return undefined;
    return schemaMap[activeWorkTab.dbName]?.find((table) => table.name === activeWorkTab.tableName);
  }, [activeWorkTab?.dbName, activeWorkTab?.tableName, schemaMap]);
  const pendingEditsMap = useMemo(() => {
    const map = new Map<string, BatchCellEdit>();
    for (const edit of pendingEdits) {
      map.set(`${edit.rowIndex}:${edit.column}`, edit);
    }
    return map;
  }, [pendingEdits]);

  const dbTreeFiltered = useMemo(() => {
    if (!searchQuery) return null;
    const q = searchQuery.toLowerCase();
    return Object.fromEntries(
      Object.entries(schemaMap).map(([db, tables]) => [
        db,
        tables.filter((t) => t.name.toLowerCase().includes(q))
      ])
    );
  }, [schemaMap, searchQuery]);

  const filteredDatabases = useMemo(() => {
    const q = dbFilter.trim().toLowerCase();
    if (!q) return databases;
    return databases.filter((database) => database.name.toLowerCase().includes(q));
  }, [databases, dbFilter]);

  async function saveSelectedDbs(connectionId: string, dbs: string[]) {
    const next = await api.saveSettings({
      ...settings,
      selectedDatabasesByConnection: {
        ...(settings.selectedDatabasesByConnection ?? {}),
        [connectionId]: dbs
      }
    });
    setSettings(next);
  }

  const toggleDb = (dbName: string) => {
    if (!activeConnectionId) return;
    setSelectedDbs((prev) => {
      if (prev.includes(dbName)) {
        const next = prev.filter((d) => d !== dbName);
        saveSelectedDbs(activeConnectionId, next).catch(() => setNotice('数据库选择保存失败'));
        return next;
      }
      const next = [...prev, dbName];
      saveSelectedDbs(activeConnectionId, next).catch(() => setNotice('数据库选择保存失败'));
      return next;
    });
  };

  const toggleExpandDb = (dbName: string) => {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(dbName)) next.delete(dbName);
      else next.add(dbName);
      return next;
    });
  };

  const refreshDbSchema = async (dbName: string) => {
    if (!activeConnectionId) return;
    try {
      const items = await api.getSchema(activeConnectionId, dbName);
      setSchemaMap((prev) => ({ ...prev, [dbName]: items }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${dbName} schema 读取失败`);
    }
  };

  // fetch schema for newly selected databases
  useEffect(() => {
    for (const db of selectedDbs) {
      if (!schemaMap[db]) {
        refreshDbSchema(db);
      }
    }
  }, [selectedDbs]);

  useEffect(() => {
    Promise.all([api.getConnections(), api.getSettings()]).then(([connectionItems, appSettings]) => {
      setConnections(connectionItems);
      setActiveConnectionId(connectionItems[0]?.id ?? '');
      setSettings(appSettings);
      setSettingsLoaded(true);
      setAiDraft(appSettings.aiProviders.find((item) => item.id === appSettings.defaultAiProviderId) ?? appSettings.aiProviders[0] ?? emptyAiProvider);
    });
    api.getQueryHistory().then(setQueryHistory).catch(() => setQueryHistory([]));
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    const selectedByConnection = settings.selectedDatabasesByConnection ?? {};
    const saved = activeConnectionId && Object.prototype.hasOwnProperty.call(selectedByConnection, activeConnectionId)
      ? selectedByConnection[activeConnectionId]
      : activeConnection?.database ? [activeConnection.database] : [];
    setSelectedDbs(saved);
    setExpandedDbs(new Set(saved));
    setSchemaMap({});
    setSelectedTable('');
    setSearchQuery('');
    setDbFilter('');
    setShowDbSelector(false);
  }, [activeConnectionId, settingsLoaded, activeConnection?.database]);

  useEffect(() => {
    setWorkTabs([createConsoleTab()]);
    setActiveWorkTabId('console');
  }, [activeConnectionId]);

  useEffect(() => {
    setPendingEdits([]);
    setActiveInlineEditor(null);
  }, [activeWorkTabId]);

  useEffect(() => {
    if (!activeConnection || activeConnection.driver !== 'mysql') {
      setDatabases([]);
      return;
    }
    api.listDatabases(activeConnection).then(setDatabases).catch(() => setDatabases([]));
  }, [activeConnectionId]);

  async function refreshAllSchemas() {
    for (const db of selectedDbs) {
      await refreshDbSchema(db);
    }
  }

  const workspaceRef = useRef<HTMLDivElement>(null);

  function startSideResize(target: 'sidebar' | 'ai-panel', initialSize: number, e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      if (target === 'sidebar') setSidebarWidth(Math.max(180, Math.min(460, initialSize + delta)));
      else setAiPanelWidth(Math.max(240, Math.min(600, initialSize - delta)));
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
    const initialH = editorHeightPx ?? Math.round(rect.height * 0.5);
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

  function updateWorkTab(tabId: string, patch: Partial<WorkTab>) {
    setWorkTabs((items) => items.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }

  function setLoadingFlag(key: keyof typeof loading, value: boolean) {
    setLoading((current) => ({ ...current, [key]: value }));
  }

  function updateActiveWorkTab(patch: Partial<WorkTab>) {
    updateWorkTab(activeWorkTabId, patch);
  }

  function closeWorkTab(tabId: string) {
    if (tabId === 'console') return;
    const index = workTabs.findIndex((tab) => tab.id === tabId);
    const next = workTabs.filter((tab) => tab.id !== tabId);
    setWorkTabs(next);
    if (activeWorkTabId === tabId) {
      setActiveWorkTabId(next[Math.max(0, index - 1)]?.id ?? 'console');
    }
  }

  function buildTableBaseSql(table: TableSchema, dbName?: string) {
    const visibleColumns = table.columns.slice(0, 12);
    const missingPrimaryColumns = table.columns.filter(
      (column) => column.primary && !visibleColumns.some((visible) => visible.name === column.name)
    );
    const columns = [...visibleColumns, ...missingPrimaryColumns].map((column) => `  ${quoteMysqlIdentifier(column.name)}`).join(',\n') || '  *';
    return `SELECT\n${columns}\nFROM ${mysqlTableRef(table.name, dbName)}`;
  }

  function composeSortedSql(tab: WorkTab, sort = tab.sort) {
    const orderClause = sort ? `\nORDER BY ${quoteMysqlIdentifier(sort.column)} ${sort.direction.toUpperCase()}` : '';

    if (tab.kind === 'table' && tab.tableName) {
      return `${stripTrailingSemicolon(tab.baseSql)}${orderClause}\nLIMIT 100;`;
    }

    const sourceSql = stripTrailingSemicolon(tab.baseSql || tab.sql);
    return `SELECT *\nFROM (\n${sourceSql}\n) q${orderClause}\nLIMIT 100;`;
  }

  function setColumnSort(column: string) {
    if (!activeWorkTab) return;
    const current = activeWorkTab.sort;
    const nextSort =
      current?.column === column && current.direction === 'asc'
        ? { column, direction: 'desc' as const }
        : current?.column === column && current.direction === 'desc'
          ? undefined
          : { column, direction: 'asc' as const };
    const nextSql = composeSortedSql(activeWorkTab, nextSort);
    updateActiveWorkTab({ sort: nextSort, sql: nextSql });
    setNotice(nextSort ? `已按 ${column} ${nextSort.direction === 'asc' ? '升序' : '降序'} 更新 SQL` : `已取消 ${column} 排序`);
    runWorkTabQuery(activeWorkTabId, nextSql);
  }

  async function runWorkTabQuery(tabId = activeWorkTabId, sqlOverride?: string) {
    const tab = workTabs.find((item) => item.id === tabId);
    if (!tab) return;
    if (!activeConnectionId) {
      setNotice('请先保存并选择一个数据库连接。');
      return;
    }
    setPendingEdits([]);
    setActiveInlineEditor(null);
    setLoadingFlag('query', true);
    setNotice('');
    try {
      const targetDb = tab.dbName ?? (selectedDbs.length === 1 ? selectedDbs[0] : undefined);
      const data = await api.runQuery(activeConnectionId, sqlOverride ?? tab.sql, targetDb);
      updateWorkTab(tabId, { result: data, resultTab: 'results' });
      api.getQueryHistory().then(setQueryHistory).catch(() => undefined);
      setNotice(`执行完成：${data.rowCount} 行 · ${data.durationMs}ms`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '查询失败');
    } finally {
      setLoadingFlag('query', false);
    }
  }

  function openTableTab(dbName: string, table: TableSchema, autoRun = true) {
    const id = `table:${activeConnectionId}:${dbName}:${table.name}`;
    const baseSql = buildTableBaseSql(table, dbName);
    const sql = `${baseSql}\nLIMIT 100;`;
    setSelectedTable(table.name);
    setActiveWorkTabId(id);
    setWorkTabs((items) => {
      if (items.some((tab) => tab.id === id)) return items;
      return [
        ...items,
        {
          id,
          title: table.name,
          kind: 'table',
          dbName,
          tableName: table.name,
          baseSql,
          sql,
          result: null,
          resultTab: 'results'
        }
      ];
    });
    if (autoRun) {
      setLoadingFlag('query', true);
      api.runQuery(activeConnectionId, sql, dbName)
        .then((data) => {
          updateWorkTab(id, { result: data, resultTab: 'results' });
          setNotice(`已打开 ${dbName}.${table.name}：${data.rowCount} 行 · ${data.durationMs}ms`);
          return api.getQueryHistory();
        })
        .then(setQueryHistory)
        .catch((error) => setNotice(error instanceof Error ? error.message : '表数据浏览失败'))
        .finally(() => setLoadingFlag('query', false));
    }
  }

  const mentionOptions = useMemo(() => {
    if (!mentionQuery) return [];
    const { db, table } = mentionQuery;
    const result: { db: string; table: TableSchema }[] = [];
    for (const [dbName, tables] of Object.entries(schemaMap)) {
      if (db && db !== dbName) continue;
      for (const t of tables) {
        if (!table || t.name.toLowerCase().includes(table.toLowerCase())) {
          result.push({ db: dbName, table: t });
        }
      }
    }
    return result;
  }, [mentionQuery, schemaMap]);

  const handleAiChange = useCallback((value: string) => {
    setAiInput(value);
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const before = value.slice(0, cursor);
    const match = before.match(/@([\w.-]*)$/);
    if (match) {
      const parts = match[1].split('.');
      setMentionQuery({
        db: parts.length > 1 ? parts[0] : '',
        table: parts.length > 1 ? parts[1] : parts[0],
        start: match.index!
      });
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  function selectMention(db: string, tableName: string) {
    if (!mentionQuery) return;
    const before = aiInput.slice(0, mentionQuery.start);
    const typedLen = 1 + (mentionQuery.db ? mentionQuery.db.length + 1 + mentionQuery.table.length : mentionQuery.table.length);
    const after = aiInput.slice(mentionQuery.start + typedLen);
    const replacement = `@${db}.${tableName} `;
    setAiInput(before + replacement + after);
    setMentionQuery(null);
    textareaRef.current?.focus();
  }

  function handleAiKeyDown(event: React.KeyboardEvent) {
    if (!mentionQuery || mentionOptions.length === 0) return;
    if (event.key === 'Escape') {
      setMentionQuery(null);
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowDown') {
      setMentionIndex((prev) => Math.min(prev + 1, mentionOptions.length - 1));
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowUp') {
      setMentionIndex((prev) => Math.max(prev - 1, 0));
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      const selected = mentionOptions[mentionIndex];
      if (selected) {
        selectMention(selected.db, selected.table.name);
        event.preventDefault();
      }
    }
  }

  async function runQuery() {
    await runWorkTabQuery();
  }

  async function generateSql() {
    setLoadingFlag('ai', true);
    const names = extractTableMentions(aiInput);
    const tables: TableSchema[] = [];
    for (const name of names) {
      if (name.includes('.')) {
        const [db, tableName] = name.split('.');
        const dbTables = schemaMap[db];
        if (dbTables) {
          const found = dbTables.find((t) => t.name === tableName);
          if (found) tables.push({ ...found, dbName: db });
        }
      } else {
        const found = allTables.find((t) => t.name === name);
        if (found) tables.push(found);
      }
    }
    const context = tables.length ? tables : selectedSchema ? [selectedSchema] : [];
    setChat((items) => [...items, { role: 'user', content: aiInput }]);

    try {
      const response: AiGenerateResponse = await api.generateSql({
        prompt: aiInput,
        dialect: activeConnection?.driver ?? 'mysql',
        tables: context
      });
      updateActiveWorkTab({ baseSql: response.sql, sql: response.sql, sort: undefined });
      setChat((items) => [
        ...items,
        {
          role: 'assistant',
          content: response.explanation,
          sql: response.sql,
          warnings: response.warnings,
          meta: `${response.source === 'local' ? 'Local' : defaultProvider?.name ?? 'AI'} · 已注入 ${response.usedTables.join(', ') || selectedTable}`
        }
      ]);
    } catch (error) {
      setChat((items) => [
        ...items,
        { role: 'assistant', content: error instanceof Error ? error.message : 'AI 生成失败', meta: 'AI 错误' }
      ]);
    } finally {
      setLoadingFlag('ai', false);
    }
  }

  function insertTableSelect(limit = 100) {
    if (!selectedSchema) {
      setNotice('请先选择一张表。');
      return;
    }
    const baseSql = buildTableBaseSql(selectedSchema, selectedSchemaDb);
    const nextSql = `${baseSql}\nLIMIT ${limit};`;
    updateActiveWorkTab({ baseSql, sql: nextSql, sort: undefined });
    setNotice(`已生成 ${selectedSchema.name} 的 SELECT 模板`);
  }

  function insertTableCount() {
    if (!selectedSchema) {
      setNotice('请先选择一张表。');
      return;
    }
    const nextSql = `SELECT COUNT(*) AS total_count\nFROM ${mysqlTableRef(selectedSchema.name, selectedSchemaDb)};`;
    updateActiveWorkTab({ baseSql: nextSql, sql: nextSql, sort: undefined });
    setNotice(`已生成 ${selectedSchema.name} 的 COUNT 模板`);
  }

  async function loadTableDdl() {
    if (!selectedSchema) {
      setNotice('请先选择一张表。');
      return;
    }
    try {
      const ddl = await api.getTableDdl(activeConnectionId, selectedSchema.name);
      const nextSql = ddl || `-- 未读取到 ${selectedSchema.name} 的 DDL`;
      updateActiveWorkTab({ baseSql: nextSql, sql: nextSql, sort: undefined });
      setNotice(`已读取 ${selectedSchema.name} 的建表 DDL`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'DDL 读取失败');
    }
  }

  function browseSelectedTable() {
    if (!selectedSchema) {
      setNotice('请先选择一张表。');
      return;
    }
    openTableTab(selectedSchemaDb ?? selectedDbs[0] ?? activeConnection?.database ?? '', selectedSchema);
  }

  function getCellEditBlockReason(row: Record<string, unknown>, column: string): string | null {
    if (!activeConnection) return '请先选择连接';
    if (activeConnection.driver !== 'mysql') return '当前仅 MySQL 支持编辑数据';
    if (activeConnection.readonly) return '当前连接为只读模式';
    if (activeWorkTab?.kind !== 'table' || !activeWorkTab.dbName || !activeWorkTab.tableName) return '普通 SQL 结果集暂不支持编辑';
    if (!activeTableSchema) return '未找到当前表结构';
    if (activeTableSchema.type === 'view') return '视图暂不支持编辑';
    const primaryColumns = activeTableSchema.columns.filter((item) => item.primary);
    if (!primaryColumns.length) return '表没有主键，无法安全定位行';
    if (primaryColumns.some((item) => !(item.name in row))) return '结果集中缺少主键列，无法安全定位行';
    if (primaryColumns.some((item) => item.name === column)) return '主键列暂不支持直接编辑';
    return null;
  }

  function beginCellEdit(rowIndex: number, row: Record<string, unknown>, column: string) {
    const reason = getCellEditBlockReason(row, column);
    if (reason) {
      setNotice(reason);
      return;
    }
    const existing = pendingEditsMap.get(`${rowIndex}:${column}`);
    const rawValue = existing ? existing.newValue : row[column];
    const asNull = existing ? existing.asNull : rawValue === null || rawValue === undefined;
    setActiveInlineEditor({
      rowIndex,
      column,
      value: (asNull && !existing) ? '' : (rawValue === null || rawValue === undefined ? '' : rawValue instanceof Date ? formatDatetime(rawValue) : String(rawValue)),
      asNull
    });
  }

  function finishCellEdit(editorState: { rowIndex: number; column: string; value: string; asNull: boolean }) {
    if (!activeResult || !activeWorkTab?.dbName || !activeWorkTab.tableName || !activeTableSchema) return;
    const row = activeResult.rows[editorState.rowIndex];
    if (!row) return;
    const rawValue = row[editorState.column];
    const originalValue = rawValue === null || rawValue === undefined ? '' : rawValue instanceof Date ? formatDatetime(rawValue) : String(rawValue);
    const newValue = editorState.asNull ? '' : editorState.value;

    setPendingEdits((prev) => {
      const filtered = prev.filter((e) => !(e.rowIndex === editorState.rowIndex && e.column === editorState.column));
      if (editorState.asNull && rawValue === null) return filtered;
      if (!editorState.asNull && newValue === originalValue) return filtered;
      return [...filtered, { rowIndex: editorState.rowIndex, column: editorState.column, newValue, originalValue, asNull: editorState.asNull }];
    });
    setActiveInlineEditor(null);
  }

  function undoEdit(rowIndex: number, column: string) {
    setPendingEdits((prev) => prev.filter((e) => !(e.rowIndex === rowIndex && e.column === column)));
  }

  function undoAllEdits() {
    setPendingEdits([]);
  }

  async function saveBatchEdits() {
    if (!pendingEdits.length || !activeResult || !activeWorkTab?.dbName || !activeWorkTab.tableName || !activeTableSchema) return;

    const edits: BatchCellEditEntry[] = [];
    for (const edit of pendingEdits) {
      const row = activeResult.rows[edit.rowIndex];
      if (!row) continue;
      const primaryKey = Object.fromEntries(
        activeTableSchema.columns.filter((c) => c.primary).map((c) => [c.name, row[c.name]])
      );
      edits.push({ column: edit.column, primaryKey, value: edit.asNull ? null : edit.newValue });
    }

    const request: BatchUpdateCellRequest = {
      connectionId: activeConnectionId,
      database: activeWorkTab.dbName,
      table: activeWorkTab.tableName,
      edits
    };

    try {
      const preview = await api.updateCellsBatch(request);
      setPendingSqlConfirm({
        title: `批量更新确认 · ${edits.length} 处修改`,
        sql: preview.sqls.join('\n'),
        onConfirm: async () => {
          setLoadingFlag('query', true);
          try {
            const response = await api.updateCellsBatch({ ...request, execute: true });
            setPendingSqlConfirm(null);
            setPendingEdits([]);
            await runWorkTabQuery(activeWorkTabId);
            setNotice(`批量更新完成：${response.affectedRows ?? 0} 行受影响`);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : '批量更新失败');
          } finally {
            setLoadingFlag('query', false);
          }
        }
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '生成批量更新 SQL 失败');
    }
  }

  function exportResult(format: 'csv' | 'json') {
    if (!activeResult) {
      setNotice('没有可导出的结果集。');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `dbmind-result-${stamp}.${format}`;
    const content =
      format === 'json'
        ? JSON.stringify(activeResult.rows, null, 2)
        : [
            activeResult.columns.join(','),
            ...activeResult.rows.map((row) =>
              activeResult.columns
                .map((column) => {
                  const value = row[column] === null || row[column] === undefined ? '' : String(row[column]);
                  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
                })
                .join(',')
            )
          ].join('\n');
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`已导出 ${filename}`);
  }

  async function clearHistory() {
    const next = await api.clearQueryHistory();
    setQueryHistory(next);
    setNotice('查询历史已清空');
  }

  async function saveConnection() {
    setLoadingFlag('connection', true);
    try {
      const id = connectionDraft.id || crypto.randomUUID();
      let draft: DbConnectionConfig = {
        ...connectionDraft,
        id,
        port: Number(connectionDraft.port),
        connectTimeout: Number(connectionDraft.connectTimeout)
      };
      if (!draft.name) {
        draft = { ...draft, name: `${driverLabel(draft.driver)} · ${draft.host || 'localhost'}:${draft.port || 3306}` };
      }
      if (draft.driver === 'mysql' && !draft.database) {
        const items = databases.length ? databases : await api.listDatabases(draft);
        const firstUserDatabase = items.find((database) => !database.system) ?? items[0];
        if (firstUserDatabase) {
          draft = { ...draft, database: firstUserDatabase.name };
          setDatabases(items);
        }
      }
      const next = await api.saveConnection(draft);
      setConnections(next);
      setConnectionDraft(draft);
      setActiveConnectionId(id);
      setShowConnectionModal(false);
      setNotice(draft.database ? `连接已保存：${draft.database}` : '连接已保存，请选择数据库');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '连接保存失败');
    } finally {
      setLoadingFlag('connection', false);
    }
  }

  async function deleteConnection(id: string) {
    const next = await api.deleteConnection(id);
    setConnections(next);
    setActiveConnectionId(next[0]?.id ?? '');
    setConnectionDraft(emptyConnection);
    setNotice('连接已删除');
  }

  function editConnection(connection: DbConnectionConfig) {
    setConnectionDraft({ ...emptyConnection, ...connection });
    setShowConnectionModal(true);
    setNotice(`正在编辑连接：${connection.name}`);
  }

  async function testConnection() {
    setLoadingFlag('connection', true);
    try {
      const draft = { ...connectionDraft, port: Number(connectionDraft.port), connectTimeout: Number(connectionDraft.connectTimeout) };
      const response = await api.testConnection(draft);
      setNotice(response.message);
      if (response.ok) {
        const items = await api.listDatabases(draft);
        setDatabases(items);
        if (!draft.database) {
          const firstUserDatabase = items.find((database) => !database.system) ?? items[0];
          if (firstUserDatabase) {
            setConnectionDraft({ ...draft, database: firstUserDatabase.name });
          }
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setLoadingFlag('connection', false);
    }
  }

  async function saveAiProvider() {
    setLoadingFlag('settings', true);
    try {
      const id = aiDraft.id || crypto.randomUUID();
      const provider = { ...aiDraft, id };
      const providers = [provider, ...settings.aiProviders.filter((item) => item.id !== id)];
      const next = await api.saveSettings({ ...settings, aiProviders: providers, defaultAiProviderId: id });
      setSettings(next);
      setAiDraft(provider);
      setNotice('AI 配置已保存');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 配置保存失败');
    } finally {
      setLoadingFlag('settings', false);
    }
  }

  async function testAiProvider() {
    setLoadingFlag('settings', true);
    try {
      const response = await api.testAiProvider({ ...aiDraft, id: aiDraft.id || 'draft' });
      setNotice(response.message);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI 配置测试失败');
    } finally {
      setLoadingFlag('settings', false);
    }
  }

  async function setDefaultProvider(id: string) {
    const next = await api.saveSettings({ ...settings, defaultAiProviderId: id });
    setSettings(next);
    const provider = next.aiProviders.find((item) => item.id === id);
    if (provider) setAiDraft(provider);
  }

  async function deleteAiProvider(id: string) {
    const providers = settings.aiProviders.filter((item) => item.id !== id);
    const next = await api.saveSettings({ ...settings, aiProviders: providers, defaultAiProviderId: providers[0]?.id });
    setSettings(next);
    setAiDraft(providers[0] ?? emptyAiProvider);
    setNotice('AI 配置已删除');
  }

  async function saveTheme(theme: AppTheme) {
    const next = await api.saveSettings({ ...settings, theme });
    setSettings(next);
    setNotice(`界面风格已切换为 ${theme}`);
  }

  function startNewConnection() {
    setConnectionDraft(emptyConnection);
    setShowConnectionModal(true);
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
            onBrowseTable={browseSelectedTable}
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

