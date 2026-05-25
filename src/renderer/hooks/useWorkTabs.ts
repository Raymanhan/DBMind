import { useState, useEffect, useCallback } from 'react';
import type { DbmindApi, QueryHistoryItem, TableSchema, WorkTab } from '../../shared/types';
import { mysqlTableRef, quoteMysqlIdentifier } from '../../shared/sql/identifiers';

function createConsoleTab(): WorkTab {
  return { id: 'console', title: 'SQL Console', kind: 'sql', baseSql: 'SELECT 1 AS connected;', sql: 'SELECT 1 AS connected;', result: null, resultTab: 'results', sort: undefined };
}

export function useWorkTabs({
  api, activeConnectionId, selectedDbs, setNotice, setLoadingFlag
}: {
  api: DbmindApi;
  activeConnectionId: string;
  selectedDbs: string[];
  setNotice: (msg: string) => void;
  setLoadingFlag: (k: 'query', v: boolean) => void;
}) {
  const [workTabs, setWorkTabs] = useState<WorkTab[]>([createConsoleTab()]);
  const [activeWorkTabId, setActiveWorkTabId] = useState('console');
  const [queryHistory, setQueryHistory] = useState<QueryHistoryItem[]>([]);

  useEffect(() => {
    setWorkTabs([createConsoleTab()]);
    setActiveWorkTabId('console');
  }, [activeConnectionId]);

  useEffect(() => {
    api.getQueryHistory().then(setQueryHistory).catch(() => setQueryHistory([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateWorkTab = useCallback((tabId: string, patch: Partial<WorkTab>) => {
    setWorkTabs((items) => items.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const updateActiveWorkTab = useCallback((patch: Partial<WorkTab>) => {
    setWorkTabs((items) => items.map((tab) => (tab.id === activeWorkTabId ? { ...tab, ...patch } : tab)));
  }, [activeWorkTabId]);

  const closeWorkTab = useCallback((tabId: string) => {
    if (tabId === 'console') return;
    setWorkTabs((items) => items.filter((tab) => tab.id !== tabId));
    setActiveWorkTabId((prev) => {
      if (prev !== tabId) return prev;
      // Compute the next tab without depending on the just-updated workTabs
      const index = workTabs.findIndex((tab) => tab.id === tabId);
      const next = workTabs.filter((tab) => tab.id !== tabId);
      return next[Math.max(0, index - 1)]?.id ?? 'console';
    });
  }, [workTabs]);

  const buildTableBaseSql = useCallback((table: TableSchema, dbName?: string) => {
    const cols = table.columns.map((c) => `  ${quoteMysqlIdentifier(c.name)}`).join(',\n') || '  *';
    return `SELECT\n${cols}\nFROM ${mysqlTableRef(table.name, dbName)}`;
  }, []);

  const runWorkTabQuery = useCallback(async (tabId: string = activeWorkTabId, sqlOverride?: string) => {
    const tab = workTabs.find((item) => item.id === tabId);
    if (!tab || !activeConnectionId) { setNotice('请先保存并选择一个数据库连接。'); return; }
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
  }, [workTabs, activeWorkTabId, activeConnectionId, selectedDbs, api, setNotice, setLoadingFlag, updateWorkTab]);

  const openTableTab = useCallback((dbName: string, table: TableSchema, autoRun = true) => {
    const id = `table:${activeConnectionId}:${dbName}:${table.name}`;
    const baseSql = buildTableBaseSql(table, dbName);
    const sql = `${baseSql}\nLIMIT 100;`;
    setActiveWorkTabId(id);
    setWorkTabs((items) => {
      if (items.some((tab) => tab.id === id)) return items;
      return [...items, { id, title: table.name, kind: 'table' as const, dbName, tableName: table.name, baseSql, sql, result: null, resultTab: 'results' as const }];
    });
    if (autoRun) {
      setLoadingFlag('query', true);
      api.runQuery(activeConnectionId, sql, dbName)
        .then((data) => { updateWorkTab(id, { result: data, resultTab: 'results' }); setNotice(`已打开 ${dbName}.${table.name}：${data.rowCount} 行 · ${data.durationMs}ms`); return api.getQueryHistory(); })
        .then(setQueryHistory)
        .catch((error) => setNotice(error instanceof Error ? error.message : '表数据浏览失败'))
        .finally(() => setLoadingFlag('query', false));
    }
  }, [activeConnectionId, buildTableBaseSql, api, setNotice, setLoadingFlag, updateWorkTab]);

  const clearHistory = useCallback(async () => {
    const next = await api.clearQueryHistory();
    setQueryHistory(next);
    setNotice('查询历史已清空');
  }, [api, setNotice]);

  return {
    workTabs, setWorkTabs, activeWorkTabId, setActiveWorkTabId, queryHistory,
    updateWorkTab, updateActiveWorkTab, closeWorkTab,
    buildTableBaseSql, runWorkTabQuery, openTableTab, clearHistory
  };
}
