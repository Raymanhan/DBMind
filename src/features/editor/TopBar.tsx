import { useEffect, useState, useCallback, useRef } from 'react';
import { Play, Square, Save, Paintbrush, Database, Loader2, History, Search } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { useEditorStore } from '../../shared/stores/editorStore';
import { useQueryExecution } from '../../shared/hooks/useQueryExecution';
import { useQueryStore } from '../../shared/stores/queryStore';
import { useConnectionStore } from '../../shared/stores/connectionStore';
import { connect, listDatabases } from '../../shared/api/tauri';
import type { EditorTab } from '../../shared/stores/editorStore';

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl+';

/** Ensure the tab has a valid connectionId — falls back to activeConnectionId */
function ensureTabConnection(tab: EditorTab | null, activeConnectionId: string | null): EditorTab | null {
  if (!tab) return null;
  if (tab.connectionId || !activeConnectionId) return tab;
  // Tab has no connectionId — patch it
  const updated = { ...tab, connectionId: activeConnectionId };
  useEditorStore.setState({
    tabs: useEditorStore.getState().tabs.map((t) =>
      t.id === tab.id ? updated : t,
    ),
  });
  return updated;
}

export function TopBar() {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const tab = useEditorStore((s) =>
    s.tabs.find((t) => t.id === activeTabId) ?? null,
  );
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const connections = useConnectionStore((s) => s.connections);
  const connectedIds = useConnectionStore((s) => s.connectedIds);
  const markConnected = useConnectionStore((s) => s.markConnected);
  const newTab = useEditorStore((s) => s.newTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const updateSql = useEditorStore((s) => s.updateSql);
  const openTab = useEditorStore((s) => s.openTab);
  const updateTabDatabase = useEditorStore((s) => s.updateTabDatabase);
  const results = useQueryStore((s) => s.results);
  const history = useQueryStore((s) => s.history);
  const clearHistory = useQueryStore((s) => s.clearHistory);
  const { runQuery, stopQuery, formatActiveSql, explainActiveSql } = useQueryExecution();
  const running = (tab?.queryIds?.length ? tab.queryIds : tab?.queryId ? [tab.queryId] : [])
    .some((queryId) => results.get(queryId)?.status === 'running');

  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
  const [switchingDb, setSwitchingDb] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);

  const isConnected = activeConnectionId != null && connectedIds.has(activeConnectionId);
  const activeConn = connections.find((c) => c.id === activeConnectionId);

  // Fetch databases for the active connection
  useEffect(() => {
    if (!activeConnectionId || !isConnected) {
      setAvailableDatabases([]);
      return;
    }
    listDatabases(activeConnectionId)
      .then(setAvailableDatabases)
      .catch(() => setAvailableDatabases([]));
  }, [activeConnectionId, isConnected]);

  const handleDatabaseChange = useCallback(
    async (database: string) => {
      if (!activeConnectionId || !activeConn) return;

      setSwitchingDb(true);
      try {
        const nextConfig = { ...activeConn, database };
        updateConnection(nextConfig);
        await connect(nextConfig);

        // Ensure connection is tracked in connectedIds
        if (!connectedIds.has(activeConnectionId)) {
          markConnected(activeConnectionId);
        }

        // Update current tab: set both database AND connectionId if empty
        if (tab) {
          updateTabDatabase(tab.id, tab.connectionId || activeConnectionId, database);
        }
      } catch (err) {
        console.error('Failed to switch database:', err);
      } finally {
        setSwitchingDb(false);
      }
    },
    [activeConnectionId, activeConn, updateConnection, connectedIds, markConnected, tab, updateTabDatabase],
  );

  // Wrap runQuery to auto-fix tab connectionId before running
  const handleRun = useCallback(() => {
    const fixed = ensureTabConnection(tab, activeConnectionId);
    if (fixed) {
      runQuery();
    }
  }, [tab, activeConnectionId, runQuery]);

  const handleSave = useCallback(async () => {
    if (!tab) return;
    const path = await save({
      defaultPath: `${tab.title || 'query'}.sql`,
      filters: [{ name: 'SQL', extensions: ['sql'] }],
    });
    if (!path) return;
    await writeTextFile(path, tab.sql);
  }, [tab]);

  const handleLoadHistory = useCallback(
    (sql: string, connectionId: string, database: string) => {
      if (tab) {
        updateSql(tab.id, sql);
        updateTabDatabase(tab.id, connectionId, database);
      } else {
        openTab({
          id: crypto.randomUUID(),
          title: sql.trim().split('\n')[0]?.slice(0, 40) || 'History',
          sql,
          connectionId,
          database,
          dirty: true,
          queryIds: [],
          activeResultIndex: 0,
        });
      }
      setHistoryOpen(false);
    },
    [openTab, tab, updateSql, updateTabDatabase],
  );

  useEffect(() => {
    if (!historyOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [historyOpen]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modKey = e.metaKey || e.ctrlKey;

      if (modKey && e.key === 'Enter') {
        e.preventDefault();
        const currentTab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId);
        if (currentTab?.sql.trim()) {
          ensureTabConnection(currentTab, activeConnectionId);
          runQuery();
        }
        return;
      }

      if (modKey && e.key === 'w') {
        e.preventDefault();
        if (activeTabId) {
          const currentTab = useEditorStore.getState().tabs.find((t) => t.id === activeTabId);
          if (currentTab?.dirty) {
            const confirmed = window.confirm('This tab has unsaved changes. Close anyway?');
            if (!confirmed) return;
          }
          closeTab(activeTabId);
        }
        return;
      }

      if (modKey && e.key === 't') {
        e.preventDefault();
        if (activeConnectionId) {
          newTab(activeConnectionId, '');
        }
        return;
      }

      if (modKey && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (activeTabId && tab?.sql.trim()) {
          formatActiveSql();
        }
        return;
      }

      if (modKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const index = parseInt(e.key) - 1;
        if (index < useEditorStore.getState().tabs.length) {
          setActiveTab(useEditorStore.getState().tabs[index].id);
        }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeTabId, activeConnectionId, tab, runQuery, closeTab, newTab, formatActiveSql, setActiveTab]);

  return (
    <div className="top-bar">
      <div className="toolbar-group">
        <button
          className="toolbar-btn run"
          disabled={!activeTabId || !tab?.sql.trim()}
          onClick={handleRun}
          title={`Execute (${mod}Enter)`}
        >
          <Play size={14} /> Run
          <span className="toolbar-kbd">{mod}↵</span>
        </button>
        <button
          className="toolbar-btn"
          disabled={!activeTabId || !running}
          onClick={() => stopQuery()}
          title="Stop"
        >
          <Square size={14} />
        </button>
      </div>
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          disabled={!activeTabId || !tab?.sql.trim()}
          onClick={() => formatActiveSql()}
          title={`Format SQL (${mod}⇧F)`}
        >
          <Paintbrush size={14} /> Format
          <span className="toolbar-kbd">{mod}⇧F</span>
        </button>
        <button
          className="toolbar-btn"
          disabled={!activeTabId || !tab?.sql.trim()}
          onClick={() => explainActiveSql()}
          title="Explain"
        >
          <Search size={14} /> Explain
        </button>
        <button className="toolbar-btn" disabled={!activeTabId} onClick={handleSave} title="Save SQL">
          <Save size={14} />
        </button>
        <div className="history-menu" ref={historyRef}>
          <button
            className="toolbar-btn"
            disabled={history.length === 0}
            onClick={() => setHistoryOpen((open) => !open)}
            title="Query history"
          >
            <History size={14} />
          </button>
          {historyOpen && (
            <div className="history-dropdown">
              <div className="history-dropdown-header">
                <span>Query History</span>
                <button onClick={clearHistory}>Clear</button>
              </div>
              {history.slice(0, 30).map((item) => (
                <button
                  key={item.id}
                  className="history-item"
                  onClick={() => handleLoadHistory(item.sql, item.connection_id, item.database)}
                  title={item.sql}
                >
                  <span className={`history-status ${item.status}`} />
                  <span className="history-sql">{item.sql.trim().replace(/\s+/g, ' ')}</span>
                  <span className="history-db">{item.database || 'default'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Database selector dropdown */}
        <div className={`db-selector-wrapper${switchingDb ? ' switching' : ''}`}>
          {switchingDb ? (
            <Loader2 size={14} className="spin" />
          ) : (
            <Database size={14} className="db-selector-icon" />
          )}
          <select
            className="db-selector"
            value={tab?.database || ''}
            onChange={(e) => handleDatabaseChange(e.target.value)}
            disabled={!isConnected || !activeTabId || switchingDb}
            title="Select database for current tab"
          >
            {!tab?.database && <option value="">Select DB…</option>}
            {availableDatabases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
