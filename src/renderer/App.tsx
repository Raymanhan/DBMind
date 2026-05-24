import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Database,
  Edit3,
  History,
  KeyRound,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Sun,
  Table2,
  Trash2,
  Wand2
} from 'lucide-react';
import type {
  AiGenerateResponse,
  AiProviderConfig,
  AppSettings,
  AppTheme,
  DatabaseInfo,
  DbConnectionConfig,
  DbmindApi,
  QueryHistoryItem,
  QueryResult,
  TableSchema,
  UpdateCellRequest
} from '../shared/types';
import { extractTableMentions } from '../shared/sqlTools';
import { TableDesignerModal } from './components/schema/TableDesigner';
import { browserFallbackApi } from './browserApi';

type AppView = 'workspace' | 'settings';
type ResultTab = 'results' | 'history';
type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  meta?: string;
  warnings?: string[];
};
type WorkTab = {
  id: string;
  title: string;
  kind: 'sql' | 'table';
  dbName?: string;
  tableName?: string;
  baseSql: string;
  sql: string;
  result: QueryResult | null;
  resultTab: ResultTab;
  sort?: { column: string; direction: 'asc' | 'desc' };
};
type PendingCellEdit = {
  rowIndex: number;
  column: string;
  value: string;
  asNull?: boolean;
};
type PendingSqlConfirm = {
  title: string;
  sql: string;
  onConfirm: () => Promise<void>;
};

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

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function driverLabel(driver: string): string {
  return driver === 'postgres' ? 'PostgreSQL' : 'MySQL';
}

function providerLabel(provider: AiProviderConfig): string {
  return `${provider.name || provider.provider} · ${provider.apiMode}`;
}

function quoteMysqlIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

function mysqlTableRef(tableName: string, dbName?: string): string {
  return dbName ? `${quoteMysqlIdentifier(dbName)}.${quoteMysqlIdentifier(tableName)}` : quoteMysqlIdentifier(tableName);
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
  const resizeRef = useRef<{ target: string; start: number; initial: number } | null>(null);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [showDbSelector, setShowDbSelector] = useState(false);
  const [notice, setNotice] = useState('');
  const [editingCell, setEditingCell] = useState<PendingCellEdit | null>(null);
  const [pendingSqlConfirm, setPendingSqlConfirm] = useState<PendingSqlConfirm | null>(null);
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

  function buildTableBrowseSql(table: TableSchema, dbName?: string, limit = 100) {
    return `${buildTableBaseSql(table, dbName)}\nLIMIT ${limit};`;
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
    const value = row[column];
    setEditingCell({ rowIndex, column, value: value === null || value === undefined ? '' : String(value), asNull: value === null });
  }

  async function commitCellEdit(edit = editingCell) {
    if (!edit || !activeResult || !activeWorkTab?.dbName || !activeWorkTab.tableName || !activeTableSchema) return;
    const row = activeResult.rows[edit.rowIndex];
    if (!row) return;
    const reason = getCellEditBlockReason(row, edit.column);
    if (reason) {
      setNotice(reason);
      setEditingCell(null);
      return;
    }
    const primaryKey = Object.fromEntries(activeTableSchema.columns.filter((item) => item.primary).map((item) => [item.name, row[item.name]]));
    const request: UpdateCellRequest = {
      connectionId: activeConnectionId,
      database: activeWorkTab.dbName,
      table: activeWorkTab.tableName,
      column: edit.column,
      primaryKey,
      value: edit.asNull ? null : edit.value
    };
    try {
      const preview = await api.updateCell(request);
      setPendingSqlConfirm({
        title: `确认更新 ${edit.column}`,
        sql: preview.sql,
        onConfirm: async () => {
          setLoadingFlag('query', true);
          try {
            const response = await api.updateCell({ ...request, execute: true });
            setPendingSqlConfirm(null);
            setEditingCell(null);
            await runWorkTabQuery(activeWorkTabId);
            setNotice(`单元格已更新：${response.affectedRows ?? 0} 行受影响`);
          } catch (error) {
            setNotice(error instanceof Error ? error.message : '单元格更新失败');
          } finally {
            setLoadingFlag('query', false);
          }
        }
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '生成更新 SQL 失败');
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
      <aside className="rail">
        <div className="brand">DB<span>Mind</span></div>
        <button className={`rail-btn ${view === 'workspace' ? 'active' : ''}`} title="数据库" onClick={() => setView('workspace')}><Database size={18} /></button>
        <button className={`rail-btn ${view === 'workspace' && !aiCollapsed ? 'active' : ''}`} title="AI 助手" onClick={() => { setView('workspace'); setAiCollapsed((value) => !value); }}><Sparkles size={18} /></button>
        <button className="rail-btn" title="历史"><History size={18} /></button>
        <button className={`rail-btn ${view === 'settings' ? 'active' : ''}`} title="设置" onClick={() => setView('settings')}><Settings size={18} /></button>
      </aside>

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
            <header className="topbar">
              <div>
                <h1>{activeWorkTab?.title || activeConnection?.name || '未选择连接'}</h1>
                <p>{activeConnection ? driverLabel(activeConnection.driver) : 'MySQL'} · {selectedDbs.length} 个数据库 · {allTables.length} 个对象 · {activeWorkTab?.dbName ? `${activeWorkTab.dbName}.${activeWorkTab.tableName}` : defaultProvider ? providerLabel(defaultProvider) : 'Local AI'}</p>
              </div>
              <div className="topbar-actions">
                {activeWorkTab?.kind === 'table' && activeWorkTab.dbName && activeWorkTab.tableName && (
                  <button
                    className="ghost"
                    onClick={() => setTableDesignerTarget({ database: activeWorkTab.dbName!, table: activeWorkTab.tableName! })}
                    disabled={loading.query || loading.ai}
                  >
                    <Edit3 size={15} /> 表设计
                  </button>
                )}
                <button className="ghost" onClick={generateSql} disabled={loading.ai || loading.query}><Wand2 size={15} /> {loading.ai ? '生成中' : 'AI 优化'}</button>
                <button className="run-btn" onClick={runQuery} disabled={loading.query || loading.ai}><Play size={16} /> {loading.query ? '执行中' : '执行'}</button>
              </div>
            </header>

            <div className="work-tab-strip">
              {workTabs.map((tab) => (
                <button
                  className={`work-tab ${tab.id === activeWorkTabId ? 'active' : ''}`}
                  key={tab.id}
                  onClick={() => setActiveWorkTabId(tab.id)}
                  title={tab.dbName ? `${tab.dbName}.${tab.tableName}` : tab.title}
                >
                  {tab.kind === 'table' ? <Table2 size={13} /> : <Database size={13} />}
                  <span>{tab.title}</span>
                  {tab.id !== 'console' && (
                    <em
                      onClick={(event) => {
                        event.stopPropagation();
                        closeWorkTab(tab.id);
                      }}
                    >
                      ×
                    </em>
                  )}
                </button>
              ))}
            </div>

            <section className="editor-zone" style={editorHeightPx ? { flex: `0 0 ${editorHeightPx}px` } : { flex: '1 1 50%' }}>
              <div className="editor-toolbar">
                <span>{activeWorkTab?.kind === 'table' && activeWorkTab.dbName ? `${activeWorkTab.dbName}.${activeWorkTab.tableName}` : 'SQL Console'}</span>
                <span>{notice || 'Ready'}</span>
              </div>
              <textarea
                value={activeSql}
                onChange={(event) => updateActiveWorkTab({ baseSql: event.target.value, sql: event.target.value, sort: undefined })}
                spellCheck={false}
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
                            const isEditing = editingCell?.rowIndex === index && editingCell.column === column;
                            return (
                              <td
                                key={column}
                                className={reason ? 'cell-readonly' : 'cell-editable'}
                                title={reason ?? '双击编辑，保存前会预览 SQL'}
                                onDoubleClick={() => beginCellEdit(index, row, column)}
                              >
                                {isEditing ? (
                                  <div className="cell-editor-wrap">
                                    <input
                                      className="cell-editor"
                                      autoFocus
                                      value={editingCell.value}
                                      placeholder={editingCell.asNull ? 'NULL' : ''}
                                      onChange={(event) => setEditingCell({ ...editingCell, value: event.target.value, asNull: false })}
                                      onBlur={() => commitCellEdit()}
                                      onKeyDown={(event) => {
                                        if (event.key === 'Enter') {
                                          event.preventDefault();
                                          event.currentTarget.blur();
                                        }
                                        if (event.key === 'Escape') {
                                          event.preventDefault();
                                          setEditingCell(null);
                                        }
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => commitCellEdit({ ...editingCell, value: '', asNull: true })}
                                      title="保存为 NULL"
                                    >
                                      NULL
                                    </button>
                                  </div>
                                ) : (
                                  formatValue(row[column])
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

      {showConnectionModal && (
        <div className="modal-overlay" onClick={() => setShowConnectionModal(false)}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>{connectionDraft.id ? '编辑连接' : '新建连接'}</h2>
              <button className="icon-btn" onClick={() => setShowConnectionModal(false)}>✕</button>
            </div>
            <ConnectionForm
              draft={connectionDraft}
              databases={databases}
              onChange={setConnectionDraft}
              onSave={saveConnection}
              onTest={testConnection}
              loading={loading.connection}
            />
          </div>
        </div>
      )}

      {pendingSqlConfirm && (
        <div className="modal-overlay" onClick={() => setPendingSqlConfirm(null)}>
          <div className="modal-content sql-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <h2>{pendingSqlConfirm.title}</h2>
              <button className="icon-btn" onClick={() => setPendingSqlConfirm(null)}>✕</button>
            </div>
            <p className="modal-note">确认后会执行以下写入 SQL，执行成功后自动刷新当前结果集。</p>
            <pre className="sql-preview">{pendingSqlConfirm.sql}</pre>
            <div className="form-actions">
              <button onClick={() => setPendingSqlConfirm(null)}>取消</button>
              <button className="primary" onClick={pendingSqlConfirm.onConfirm} disabled={loading.query}>
                <Save size={14} /> {loading.query ? '执行中' : '确认执行'}
              </button>
            </div>
          </div>
        </div>
      )}

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

function ConnectionForm({
  draft,
  databases,
  loading,
  onChange,
  onSave,
  onTest
}: {
  draft: DbConnectionConfig;
  databases: DatabaseInfo[];
  loading: boolean;
  onChange: (draft: DbConnectionConfig) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  return (
    <div className="connection-form">
      <div className="form-row">
        <input placeholder="连接名" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        <select
          value={draft.driver}
          onChange={(event) =>
            onChange({
              ...draft,
              driver: event.target.value as DbConnectionConfig['driver'],
              port: event.target.value === 'postgres' ? 5432 : 3306
            })
          }
        >
          <option value="mysql">MySQL</option>
          <option value="postgres">PostgreSQL</option>
        </select>
      </div>
      <div className="form-row">
        <input placeholder="Host" value={draft.host} onChange={(event) => onChange({ ...draft, host: event.target.value })} />
        <input placeholder="Port" value={draft.port} onChange={(event) => onChange({ ...draft, port: Number(event.target.value) })} />
      </div>
      {databases.length > 0 ? (
        <select value={draft.database} onChange={(event) => onChange({ ...draft, database: event.target.value })}>
          <option value="">选择数据库</option>
          {databases.map((database) => (
            <option key={database.name} value={database.name}>{database.system ? `${database.name} · system` : database.name}</option>
          ))}
        </select>
      ) : (
        <input placeholder="Database" value={draft.database} onChange={(event) => onChange({ ...draft, database: event.target.value })} />
      )}
      <div className="form-row">
        <input placeholder="User" value={draft.user} onChange={(event) => onChange({ ...draft, user: event.target.value })} />
        <input type="password" placeholder="Password" value={draft.password} onChange={(event) => onChange({ ...draft, password: event.target.value })} />
      </div>
      <div className="form-row">
        <input placeholder="Charset" value={draft.charset} onChange={(event) => onChange({ ...draft, charset: event.target.value })} />
        <input placeholder="Timeout ms" value={draft.connectTimeout} onChange={(event) => onChange({ ...draft, connectTimeout: Number(event.target.value) })} />
      </div>
      <label className="check-row">
        <input type="checkbox" checked={Boolean(draft.readonly)} onChange={(event) => onChange({ ...draft, readonly: event.target.checked })} />
        <span>只读模式</span>
      </label>
      <div className="form-actions">
        <button onClick={onTest} disabled={loading}><KeyRound size={14} /> {loading ? '测试中' : '测试'}</button>
        <button className="primary" onClick={onSave} disabled={loading}><Save size={14} /> {loading ? '保存中' : '保存'}</button>
      </div>
    </div>
  );
}

function AiPanel({
  selectedSchema,
  chat,
  aiInput,
  mentionedTables,
  busy,
  aiLoading,
  textareaRef,
  mentionQuery,
  mentionOptions,
  mentionIndex,
  aiPanelWidth,
  collapsed,
  onToggleCollapsed,
  onStartResize,
  onInput,
  onKeyDown,
  onSelectMention,
  onGenerate,
  onSelectTemplate,
  onCountTemplate,
  onLoadDdl,
  onBrowseTable,
  onDesignTable,
  onClear
}: {
  selectedSchema?: TableSchema;
  chat: ChatMessage[];
  aiInput: string;
  mentionedTables: string[];
  busy: boolean;
  aiLoading: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  mentionQuery: { db: string; table: string; start: number } | null;
  mentionOptions: { db: string; table: TableSchema }[];
  mentionIndex: number;
  aiPanelWidth: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onStartResize: (target: 'sidebar' | 'ai-panel', initialSize: number, e: React.MouseEvent) => void;
  onInput: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onSelectMention: (db: string, table: string) => void;
  onGenerate: () => void;
  onSelectTemplate: () => void;
  onCountTemplate: () => void;
  onLoadDdl: () => void;
  onBrowseTable: () => void;
  onDesignTable: () => void;
  onClear: () => void;
}) {
  if (collapsed) {
    return (
      <aside className="ai-panel collapsed">
        <button className="ai-collapsed-btn" title="展开 AI 助手" onClick={onToggleCollapsed}>
          <Sparkles size={18} />
          <span>AI</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="ai-panel">
      <div className="resize-handle-col" onMouseDown={(e) => onStartResize('ai-panel', aiPanelWidth, e)} />
      <div className="ai-panel-body">
      <div className="ai-head">
        <div>
          <p><Bot size={16} /> AI 助手</p>
          <strong>@table Schema Context</strong>
        </div>
        <button className="icon-btn" title="收起 AI 助手" onClick={onToggleCollapsed}><ChevronDown size={16} /></button>
      </div>

      <div className="schema-card">
        <div className="section-label">当前表结构</div>
        <h2>{selectedSchema?.name ?? '未选择表'}</h2>
        {selectedSchema && (
          <div className="table-meta">
            <span>{selectedSchema.type ?? 'table'}</span>
            {selectedSchema.engine && <span>{selectedSchema.engine}</span>}
            {selectedSchema.rowCount !== undefined && <span>~{selectedSchema.rowCount} rows</span>}
          </div>
        )}
        <div className="columns">
          {selectedSchema?.columns.map((column) => (
            <div className="column-row" key={column.name}>
              <span>{column.name}{column.primary ? ' · PK' : ''}{column.references ? ` · FK ${column.references}` : ''}</span>
              <em>{column.type}</em>
            </div>
          ))}
        </div>
        <div className="table-actions">
          <button onClick={onBrowseTable} disabled={!selectedSchema} title="浏览表数据"><Table2 size={13} /> 浏览</button>
          <button onClick={onDesignTable} disabled={!selectedSchema} title="打开表设计器"><Edit3 size={13} /> 设计</button>
          <button onClick={onSelectTemplate} disabled={!selectedSchema} title="生成 SELECT">SELECT</button>
          <button onClick={onCountTemplate} disabled={!selectedSchema} title="生成 COUNT">COUNT</button>
          <button onClick={onLoadDdl} disabled={!selectedSchema} title="读取 DDL">DDL</button>
        </div>
      </div>

      <div className="chat-list">
        {chat.map((message, index) => (
          <div className={`chat-message ${message.role}`} key={index}>
            {message.meta && <div className="meta">{message.meta}</div>}
            <p>{message.content}</p>
            {message.sql && <pre>{message.sql}</pre>}
            {message.warnings?.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
          </div>
        ))}
        {aiLoading && (
          <div className="chat-message assistant loading-message">
            <div className="meta">AI 助手</div>
            <p><span className="spinner" /> 正在生成 SQL...</p>
          </div>
        )}
      </div>

      <div className="composer">
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            value={aiInput}
            placeholder="使用 @ 引用表结构，描述查询需求..."
            onChange={(event) => onInput(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {mentionQuery && mentionOptions.length > 0 && (
            <div className="mention-dropdown">
              {mentionOptions.map((opt, idx) => (
                <button
                  key={`${opt.db}.${opt.table.name}`}
                  className={`mention-item ${idx === mentionIndex ? 'active' : ''}`}
                  onClick={() => onSelectMention(opt.db, opt.table.name)}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <span className="mention-db">{opt.db}</span>
                  <span className="mention-table">{opt.table.name}</span>
                  <em>{opt.table.columns.length}</em>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="composer-footer">
          <span>{mentionedTables.length ? `已引用 ${mentionedTables.join(', ')}` : '输入 @ 引用表'}</span>
          <button onClick={onGenerate} disabled={busy}><Sparkles size={15} /> {aiLoading ? '生成中' : '生成 SQL'}</button>
          <button className="text-danger" onClick={onClear} title="清空对话"><Trash2 size={14} /></button>
        </div>
      </div>
      </div>
    </aside>
  );
}

function HistoryPanel({
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

function SettingsView({
  aiDraft,
  settings,
  notice,
  onChange,
  onSave,
  onTest,
  onDefault,
  onEdit,
  onDelete,
  onThemeChange,
  loading
}: {
  aiDraft: AiProviderConfig;
  settings: AppSettings;
  notice: string;
  onChange: (draft: AiProviderConfig) => void;
  onSave: () => void;
  onTest: () => void;
  onDefault: (id: string) => void;
  onEdit: (provider: AiProviderConfig) => void;
  onDelete: (id: string) => void;
  onThemeChange: (theme: AppTheme) => void;
  loading: boolean;
}) {
  const [settingsTab, setSettingsTab] = useState<'general' | 'ai'>('general');
  const activeTheme = settings.theme ?? 'dark';

  return (
    <main className="settings-page">
      <header className="settings-hero">
        <div>
          <p>Settings</p>
          <h1>{settingsTab === 'general' ? '通用配置' : 'AI 模型配置'}</h1>
          <span>{settingsTab === 'general' ? '调整桌面端显示风格与日常使用偏好。' : '兼容 OpenAI、OpenAI Compatible、Azure OpenAI、Ollama 与自定义 OpenAI 格式服务。'}</span>
        </div>
        {settingsTab === 'ai' && (
          <button className="run-btn" onClick={() => onChange({ ...emptyAiProvider, id: '' })}><Plus size={16} /> 新建配置</button>
        )}
      </header>

      <div className="settings-tabs">
        <button className={settingsTab === 'general' ? 'active' : ''} onClick={() => setSettingsTab('general')}>
          <Settings size={15} /> 通用配置
        </button>
        <button className={settingsTab === 'ai' ? 'active' : ''} onClick={() => setSettingsTab('ai')}>
          <Sparkles size={15} /> AI 模型配置
        </button>
      </div>

      {settingsTab === 'general' ? (
        <section className="settings-layout general-layout">
          <div className="settings-card">
            <div className="settings-card-head">
              <div>
                <p>Appearance</p>
                <h2>界面风格</h2>
              </div>
              {notice && <span>{notice}</span>}
            </div>
            <div className="theme-options">
              <button className={`theme-option ${activeTheme === 'dark' ? 'active' : ''}`} onClick={() => onThemeChange('dark')}>
                <span className="theme-swatch dark"><Moon size={18} /></span>
                <strong>Dark</strong>
                <em>深色工作台，适合长时间编写 SQL。</em>
              </button>
              <button className={`theme-option ${activeTheme === 'light' ? 'active' : ''}`} onClick={() => onThemeChange('light')}>
                <span className="theme-swatch light"><Sun size={18} /></span>
                <strong>Light</strong>
                <em>浅色界面，高对比表格与清爽面板。</em>
              </button>
            </div>
          </div>
        </section>
      ) : (
      <section className="settings-layout">
        <div className="settings-card">
          <div className="settings-card-head">
            <div>
              <p>Provider Form</p>
              <h2>{aiDraft.id ? '编辑 AI 配置' : '新建 AI 配置'}</h2>
            </div>
            {notice && <span>{notice}</span>}
          </div>

          <div className="settings-grid">
            <label>
              名称
              <input value={aiDraft.name} onChange={(event) => onChange({ ...aiDraft, name: event.target.value })} />
            </label>
            <label>
              Provider
              <select value={aiDraft.provider} onChange={(event) => onChange({ ...aiDraft, provider: event.target.value as AiProviderConfig['provider'] })}>
                <option value="openai">OpenAI</option>
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="azure-openai">Azure OpenAI</option>
                <option value="ollama">Ollama</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label>
              API Mode
              <select value={aiDraft.apiMode} onChange={(event) => onChange({ ...aiDraft, apiMode: event.target.value as AiProviderConfig['apiMode'] })}>
                <option value="chat-completions">/v1/chat/completions</option>
                <option value="responses">/v1/responses</option>
              </select>
            </label>
            <label>
              Model
              <input value={aiDraft.model} onChange={(event) => onChange({ ...aiDraft, model: event.target.value })} />
            </label>
            <label className="wide">
              Base URL
              <input value={aiDraft.baseUrl} onChange={(event) => onChange({ ...aiDraft, baseUrl: event.target.value })} />
            </label>
            <label className="wide">
              API Key
              <input type="password" value={aiDraft.apiKey ?? ''} onChange={(event) => onChange({ ...aiDraft, apiKey: event.target.value })} />
            </label>
            <label>
              Temperature
              <input value={aiDraft.temperature} onChange={(event) => onChange({ ...aiDraft, temperature: Number(event.target.value) })} />
            </label>
            <label>
              Max Output Tokens
              <input value={aiDraft.maxOutputTokens} onChange={(event) => onChange({ ...aiDraft, maxOutputTokens: Number(event.target.value) })} />
            </label>
            <label>
              Timeout ms
              <input value={aiDraft.timeoutMs} onChange={(event) => onChange({ ...aiDraft, timeoutMs: Number(event.target.value) })} />
            </label>
            <label>
              默认 SQL 方言
              <select value={aiDraft.defaultDialect} onChange={(event) => onChange({ ...aiDraft, defaultDialect: event.target.value as AiProviderConfig['defaultDialect'] })}>
                <option value="mysql">MySQL</option>
                <option value="postgres">PostgreSQL</option>
              </select>
            </label>
          </div>

          <div className="settings-checks">
            <label><input type="checkbox" checked={Boolean(aiDraft.streaming)} onChange={(event) => onChange({ ...aiDraft, streaming: event.target.checked })} /> 启用流式输出</label>
            <label><input type="checkbox" checked={Boolean(aiDraft.appendLimit)} onChange={(event) => onChange({ ...aiDraft, appendLimit: event.target.checked })} /> 默认追加 LIMIT</label>
            <label><input type="checkbox" checked={Boolean(aiDraft.allowWriteSql)} onChange={(event) => onChange({ ...aiDraft, allowWriteSql: event.target.checked })} /> 允许 AI 生成写操作</label>
          </div>

          <div className="settings-actions">
            <button onClick={onTest} disabled={loading}><Cpu size={15} /> {loading ? '测试中' : '测试模型'}</button>
            <button className="primary" onClick={onSave} disabled={loading}><Save size={15} /> {loading ? '保存中' : '保存并设为默认'}</button>
          </div>
        </div>

        <div className="settings-card provider-list-card">
          <div className="settings-card-head">
            <div>
              <p>Providers</p>
              <h2>已保存配置</h2>
            </div>
          </div>
          <div className="provider-list">
            {settings.aiProviders.map((provider) => (
              <div className="provider-item" key={provider.id}>
                <div>
                  <strong>{provider.name}</strong>
                  <span>{provider.model} · {provider.apiMode}</span>
                </div>
                <div className="provider-actions">
                  {settings.defaultAiProviderId === provider.id && <CheckCircle2 size={16} className="ok-icon" />}
                  <button onClick={() => onDefault(provider.id)}>默认</button>
                  <button onClick={() => onEdit(provider)}><Edit3 size={13} /></button>
                  <button onClick={() => onDelete(provider.id)}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      )}
    </main>
  );
}
