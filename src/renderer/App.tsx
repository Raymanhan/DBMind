import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Database,
  Edit3,
  History,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Sparkles,
  Table2,
  Trash2,
  Wand2
} from 'lucide-react';
import type {
  AiGenerateResponse,
  AiProviderConfig,
  AppSettings,
  DatabaseInfo,
  DbConnectionConfig,
  DbmindApi,
  QueryHistoryItem,
  QueryResult,
  TableSchema
} from '../shared/types';
import { extractTableMentions } from '../shared/sqlTools';
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

export function App() {
  const [view, setView] = useState<AppView>('workspace');
  const [connections, setConnections] = useState<DbConnectionConfig[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState('');
  const [schema, setSchema] = useState<TableSchema[]>([]);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [selectedTable, setSelectedTable] = useState('');
  const [sql, setSql] = useState(seedSql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [resultTab, setResultTab] = useState<ResultTab>('results');
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [aiInput, setAiInput] = useState('查询 @table_name 前 20 行数据');
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: '选择表后在输入框使用 @table 描述查询需求，我会把 SQL 生成到控制台。',
      meta: 'AI 助手 · Schema-aware'
    }
  ]);
  const [connectionDraft, setConnectionDraft] = useState<DbConnectionConfig>(emptyConnection);
  const [settings, setSettings] = useState<AppSettings>({ aiProviders: [], defaultAiProviderId: undefined });
  const [aiDraft, setAiDraft] = useState<AiProviderConfig>(emptyAiProvider);
  const [notice, setNotice] = useState('');

  const activeConnection = connections.find((connection) => connection.id === activeConnectionId) ?? connections[0];
  const selectedSchema = schema.find((table) => table.name === selectedTable);
  const mentionedTables = useMemo(() => extractTableMentions(aiInput), [aiInput]);
  const defaultProvider = settings.aiProviders.find((provider) => provider.id === settings.defaultAiProviderId) ?? settings.aiProviders[0];

  useEffect(() => {
    Promise.all([api.getConnections(), api.getSettings()]).then(([connectionItems, appSettings]) => {
      setConnections(connectionItems);
      setActiveConnectionId(connectionItems[0]?.id ?? '');
      setSettings(appSettings);
      setAiDraft(appSettings.aiProviders.find((item) => item.id === appSettings.defaultAiProviderId) ?? appSettings.aiProviders[0] ?? emptyAiProvider);
    });
    api.getQueryHistory().then(setQueryHistory).catch(() => setQueryHistory([]));
  }, []);

  useEffect(() => {
    if (!activeConnectionId) return;
    refreshSchema(activeConnectionId);
  }, [activeConnectionId]);

  useEffect(() => {
    if (!activeConnection || activeConnection.driver !== 'mysql') {
      setDatabases([]);
      return;
    }
    api.listDatabases(activeConnection).then(setDatabases).catch(() => setDatabases([]));
  }, [activeConnectionId, activeConnection?.database]);

  async function refreshSchema(connectionId = activeConnectionId) {
    if (!connectionId) return;
    try {
      const connection = connections.find((item) => item.id === connectionId);
      if (connection?.driver === 'mysql' && !connection.database) {
        setSchema([]);
        setSelectedTable('');
        setNotice('请选择数据库后刷新对象列表。');
        return;
      }
      const items = await api.getSchema(connectionId);
      setSchema(items);
      setSelectedTable((current) => (items.some((table) => table.name === current) ? current : items[0]?.name ?? ''));
      setNotice(`Schema 已刷新：${items.length} 个对象`);
    } catch (error) {
      setSchema([]);
      setNotice(error instanceof Error ? error.message : 'Schema 读取失败');
    }
  }

  async function runQuery() {
    if (!activeConnectionId) {
      setNotice('请先保存并选择一个数据库连接。');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const data = await api.runQuery(activeConnectionId, sql);
      setResult(data);
      setResultTab('results');
      api.getQueryHistory().then(setQueryHistory).catch(() => undefined);
      setNotice(`执行完成：${data.rowCount} 行 · ${data.durationMs}ms`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '查询失败');
    } finally {
      setBusy(false);
    }
  }

  async function generateSql() {
    setBusy(true);
    const names = extractTableMentions(aiInput);
    const tables = schema.filter((table) => names.includes(table.name));
    const context = tables.length ? tables : selectedSchema ? [selectedSchema] : [];
    setChat((items) => [...items, { role: 'user', content: aiInput }]);

    try {
      const response: AiGenerateResponse = await api.generateSql({
        prompt: aiInput,
        dialect: activeConnection?.driver ?? 'mysql',
        tables: context
      });
      setSql(response.sql);
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
      setBusy(false);
    }
  }

  function insertTableSelect(limit = 100) {
    if (!selectedSchema) {
      setNotice('请先选择一张表。');
      return;
    }
    const columns = selectedSchema.columns.slice(0, 12).map((column) => `  \`${column.name}\``).join(',\n') || '  *';
    setSql(`SELECT\n${columns}\nFROM \`${selectedSchema.name}\`\nLIMIT ${limit};`);
    setNotice(`已生成 ${selectedSchema.name} 的 SELECT 模板`);
  }

  function insertTableCount() {
    if (!selectedSchema) {
      setNotice('请先选择一张表。');
      return;
    }
    setSql(`SELECT COUNT(*) AS total_count\nFROM \`${selectedSchema.name}\`;`);
    setNotice(`已生成 ${selectedSchema.name} 的 COUNT 模板`);
  }

  async function loadTableDdl() {
    if (!selectedSchema) {
      setNotice('请先选择一张表。');
      return;
    }
    try {
      const ddl = await api.getTableDdl(activeConnectionId, selectedSchema.name);
      setSql(ddl || `-- 未读取到 ${selectedSchema.name} 的 DDL`);
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
    const columns = selectedSchema.columns.slice(0, 12).map((column) => `  \`${column.name}\``).join(',\n') || '  *';
    const browseSql = `SELECT\n${columns}\nFROM \`${selectedSchema.name}\`\nLIMIT 100;`;
    setSql(browseSql);
    setBusy(true);
    api.runQuery(activeConnectionId, browseSql)
      .then((data) => {
        setResult(data);
        setResultTab('results');
        setNotice(`已浏览 ${selectedSchema.name}：${data.rowCount} 行 · ${data.durationMs}ms`);
        return api.getQueryHistory();
      })
      .then(setQueryHistory)
      .catch((error) => setNotice(error instanceof Error ? error.message : '表数据浏览失败'))
      .finally(() => setBusy(false));
  }

  function exportResult(format: 'csv' | 'json') {
    if (!result) {
      setNotice('没有可导出的结果集。');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `dbmind-result-${stamp}.${format}`;
    const content =
      format === 'json'
        ? JSON.stringify(result.rows, null, 2)
        : [
            result.columns.join(','),
            ...result.rows.map((row) =>
              result.columns
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
    setBusy(true);
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
      setResult(null);
      setNotice(draft.database ? `连接已保存：${draft.database}` : '连接已保存，请选择数据库');
      setTimeout(() => void refreshSchema(id), 0);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '连接保存失败');
    } finally {
      setBusy(false);
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
    setNotice(`正在编辑连接：${connection.name}`);
  }

  async function testConnection() {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function selectDatabase(database: string) {
    if (!activeConnection) {
      setConnectionDraft((draft) => ({ ...draft, database }));
      return;
    }
    const updated = { ...activeConnection, database };
    const next = await api.saveConnection(updated);
    setConnections(next);
    setActiveConnectionId(updated.id);
    setConnectionDraft((draft) => (draft.id === updated.id ? updated : draft));
    setResult(null);
  }

  async function saveAiProvider() {
    const id = aiDraft.id || crypto.randomUUID();
    const provider = { ...aiDraft, id };
    const providers = [provider, ...settings.aiProviders.filter((item) => item.id !== id)];
    const next = await api.saveSettings({ aiProviders: providers, defaultAiProviderId: id });
    setSettings(next);
    setAiDraft(provider);
    setNotice('AI 配置已保存');
  }

  async function testAiProvider() {
    const response = await api.testAiProvider({ ...aiDraft, id: aiDraft.id || 'draft' });
    setNotice(response.message);
  }

  async function setDefaultProvider(id: string) {
    const next = await api.saveSettings({ ...settings, defaultAiProviderId: id });
    setSettings(next);
    const provider = next.aiProviders.find((item) => item.id === id);
    if (provider) setAiDraft(provider);
  }

  async function deleteAiProvider(id: string) {
    const providers = settings.aiProviders.filter((item) => item.id !== id);
    const next = await api.saveSettings({ aiProviders: providers, defaultAiProviderId: providers[0]?.id });
    setSettings(next);
    setAiDraft(providers[0] ?? emptyAiProvider);
    setNotice('AI 配置已删除');
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <div className="brand">DB<span>Mind</span></div>
        <button className={`rail-btn ${view === 'workspace' ? 'active' : ''}`} title="数据库" onClick={() => setView('workspace')}><Database size={18} /></button>
        <button className="rail-btn" title="AI 助手" onClick={() => setView('workspace')}><Sparkles size={18} /></button>
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
        />
      ) : (
        <>
          <aside className="sidebar">
            <div className="panel-head">
              <div>
                <p>连接</p>
                <strong>{activeConnection?.name ?? '未连接'}</strong>
              </div>
              <button className="icon-btn" title="新建连接" onClick={() => setConnectionDraft(emptyConnection)}><Plus size={16} /></button>
            </div>

            <div className="connection-list">
              {connections.map((connection) => (
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

            <ConnectionForm
              draft={connectionDraft}
              databases={databases}
              onChange={setConnectionDraft}
              onSave={saveConnection}
              onTest={testConnection}
            />

            <div className="object-browser">
              <div className="section-title-row">
                <div className="section-label">对象</div>
                <button className="tiny-btn" onClick={() => refreshSchema()} title="刷新 Schema"><RefreshCw size={13} /></button>
              </div>
              {activeConnection?.driver === 'mysql' && databases.length > 0 && (
                <select className="database-select" value={activeConnection.database ?? ''} onChange={(event) => selectDatabase(event.target.value)}>
                  {databases.map((database) => (
                    <option key={database.name} value={database.name}>{database.system ? `${database.name} · system` : database.name}</option>
                  ))}
                </select>
              )}
              <div className="searchbox"><Search size={14} /><span>搜索对象</span></div>
              {schema.map((table) => (
                <button
                  className={`table-item ${table.name === selectedTable ? 'active' : ''} ${mentionedTables.includes(table.name) ? 'mentioned' : ''}`}
                  key={table.name}
                  onClick={() => setSelectedTable(table.name)}
                >
                  <Table2 size={15} />
                  <span>{table.name}</span>
                  <em>{table.type === 'view' ? 'view' : table.columns.length}</em>
                </button>
              ))}
            </div>
          </aside>

          <main className="workspace">
            <header className="topbar">
              <div>
                <h1>{activeConnection?.database || '未选择连接'}</h1>
                <p>{activeConnection ? driverLabel(activeConnection.driver) : 'MySQL'} · {schema.length} objects · {defaultProvider ? providerLabel(defaultProvider) : 'Local AI'}</p>
              </div>
              <div className="topbar-actions">
                <button className="ghost" onClick={generateSql} disabled={busy}><Wand2 size={15} /> AI 优化</button>
                <button className="run-btn" onClick={runQuery} disabled={busy}><Play size={16} /> 执行</button>
              </div>
            </header>

            <section className="editor-zone">
              <div className="editor-toolbar">
                <span>SQL Console</span>
                <span>{notice || 'Ready'}</span>
              </div>
              <textarea value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false} />
            </section>

            <section className="result-zone">
              <div className="tabs">
                <button className={resultTab === 'results' ? 'active' : ''} onClick={() => setResultTab('results')}>结果集</button>
                <button className={resultTab === 'history' ? 'active' : ''} onClick={() => setResultTab('history')}>查询历史</button>
                <button onClick={() => exportResult('csv')}>CSV</button>
                <button onClick={() => exportResult('json')}>JSON</button>
                <span>{result ? `${result.rowCount} rows · ${result.durationMs}ms` : '尚未执行'}</span>
              </div>
              <div className="table-wrap">
                {resultTab === 'history' ? (
                  <HistoryPanel history={queryHistory} onUseSql={setSql} onClear={clearHistory} />
                ) : result ? (
                  <table>
                    <thead>
                      <tr>{result.columns.map((column) => <th key={column}>{column}</th>)}</tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, index) => (
                        <tr key={index}>
                          {result.columns.map((column) => <td key={column}>{formatValue(row[column])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state">连接 MySQL 后执行 SQL，结果会显示在这里。</div>
                )}
              </div>
            </section>
          </main>

          <AiPanel
            selectedSchema={selectedSchema}
            chat={chat}
            aiInput={aiInput}
            mentionedTables={mentionedTables}
            busy={busy}
            onInput={setAiInput}
            onGenerate={generateSql}
            onSelectTemplate={() => insertTableSelect(100)}
            onCountTemplate={insertTableCount}
            onLoadDdl={loadTableDdl}
            onBrowseTable={browseSelectedTable}
            onClear={() => setChat([])}
          />
        </>
      )}
    </div>
  );
}

function ConnectionForm({
  draft,
  databases,
  onChange,
  onSave,
  onTest
}: {
  draft: DbConnectionConfig;
  databases: DatabaseInfo[];
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
        <button onClick={onTest}><KeyRound size={14} /> 测试</button>
        <button className="primary" onClick={onSave}><Save size={14} /> 保存</button>
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
  onInput,
  onGenerate,
  onSelectTemplate,
  onCountTemplate,
  onLoadDdl,
  onBrowseTable,
  onClear
}: {
  selectedSchema?: TableSchema;
  chat: ChatMessage[];
  aiInput: string;
  mentionedTables: string[];
  busy: boolean;
  onInput: (value: string) => void;
  onGenerate: () => void;
  onSelectTemplate: () => void;
  onCountTemplate: () => void;
  onLoadDdl: () => void;
  onBrowseTable: () => void;
  onClear: () => void;
}) {
  return (
    <aside className="ai-panel">
      <div className="ai-head">
        <div>
          <p><Bot size={16} /> AI 助手</p>
          <strong>@table Schema Context</strong>
        </div>
        <ChevronDown size={16} />
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
          <button onClick={onBrowseTable} disabled={!selectedSchema}>浏览</button>
          <button onClick={onSelectTemplate} disabled={!selectedSchema}>SELECT</button>
          <button onClick={onCountTemplate} disabled={!selectedSchema}>COUNT</button>
          <button onClick={onLoadDdl} disabled={!selectedSchema}>DDL</button>
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
      </div>

      <div className="composer">
        <textarea value={aiInput} onChange={(event) => onInput(event.target.value)} />
        <div className="composer-footer">
          <span>{mentionedTables.length ? `已引用 ${mentionedTables.join(', ')}` : '输入 @ 引用表'}</span>
          <button onClick={onGenerate} disabled={busy}><Sparkles size={15} /> 生成 SQL</button>
        </div>
      </div>

      <button className="danger" onClick={onClear}><Trash2 size={14} /> 清空对话</button>
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
            <span>{new Date(item.createdAt).toLocaleString()} · {item.rowCount} rows · {item.durationMs}ms</span>
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
  onDelete
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
}) {
  return (
    <main className="settings-page">
      <header className="settings-hero">
        <div>
          <p>Settings</p>
          <h1>AI 模型配置</h1>
          <span>兼容 OpenAI、OpenAI Compatible、Azure OpenAI、Ollama 与自定义 OpenAI 格式服务。</span>
        </div>
        <button className="run-btn" onClick={() => onChange({ ...emptyAiProvider, id: '' })}><Plus size={16} /> 新建配置</button>
      </header>

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
            <button onClick={onTest}><Cpu size={15} /> 测试模型</button>
            <button className="primary" onClick={onSave}><Save size={15} /> 保存并设为默认</button>
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
    </main>
  );
}
