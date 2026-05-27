import { useCallback, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useQueryStore } from '../stores/queryStore';
import { useTauriEvents } from './useTauriEvents';
import { cancelQuery, executeQuery, formatSql } from '../api/tauri';
import type { ColumnMeta, QueryStatus } from '../api/types';
import { splitSqlStatements, statementLabel } from '../sql/statements';

interface QueryReadyData {
  query_id: string;
  columns: ColumnMeta[];
  row_count?: number;
  execution_time_ms: number;
  affected_rows?: number;
}

interface QueryErrorData {
  query_id: string;
  error: string;
}

interface QueryCancelledData {
  query_id: string;
}

type QueryWaiter = (status: QueryStatus) => void;

function parseErrorLine(error: string, startLine: number): number | undefined {
  const match = error.match(/\bline\s+(\d+)\b/i);
  if (!match) return undefined;
  const relativeLine = Number(match[1]);
  if (!Number.isFinite(relativeLine) || relativeLine < 1) return undefined;
  return startLine + relativeLine - 1;
}

function historyId(queryId: string) {
  return `hist:${queryId}`;
}

export function useQueryExecution() {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const updateQueryIds = useEditorStore((s) => s.updateQueryIds);
  const updateSql = useEditorStore((s) => s.updateSql);
  const updateErrorLine = useEditorStore((s) => s.updateErrorLine);
  const setResult = useQueryStore((s) => s.setResult);
  const updateResult = useQueryStore((s) => s.updateResult);
  const addHistory = useQueryStore((s) => s.addHistory);
  const updateHistory = useQueryStore((s) => s.updateHistory);
  const waitersRef = useRef(new Map<string, QueryWaiter>());

  const resolveWaiter = useCallback((queryId: string, status: QueryStatus) => {
    waitersRef.current.get(queryId)?.(status);
    waitersRef.current.delete(queryId);
  }, []);

  const handleQueryReady = useCallback(
    (data: QueryReadyData) => {
      updateResult(data.query_id, {
        query_id: data.query_id,
        columns: data.columns,
        status: 'ready',
        row_count: data.row_count,
        execution_time_ms: data.execution_time_ms,
        affected_rows: data.affected_rows,
      });
      updateHistory(historyId(data.query_id), {
        status: 'ready',
        duration_ms: data.execution_time_ms,
      });
      resolveWaiter(data.query_id, 'ready');
    },
    [resolveWaiter, updateHistory, updateResult],
  );

  const handleQueryError = useCallback(
    (data: QueryErrorData) => {
      const current = useQueryStore.getState().results.get(data.query_id);
      const errorLine = parseErrorLine(data.error, current?.error_line ?? 1);
      updateResult(data.query_id, {
        status: 'error',
        error: data.error,
        error_line: errorLine,
      });
      updateHistory(historyId(data.query_id), {
        status: 'error',
        error: data.error,
      });
      const tab = useEditorStore
        .getState()
        .tabs.find((candidate) => candidate.queryIds?.includes(data.query_id) || candidate.queryId === data.query_id);
      if (tab && errorLine) {
        updateErrorLine(tab.id, errorLine);
      }
      resolveWaiter(data.query_id, 'error');
    },
    [resolveWaiter, updateErrorLine, updateHistory, updateResult],
  );

  const handleQueryCancelled = useCallback(
    (data: QueryCancelledData) => {
      updateResult(data.query_id, { status: 'cancelled' });
      updateHistory(historyId(data.query_id), { status: 'cancelled' });
      resolveWaiter(data.query_id, 'cancelled');
    },
    [resolveWaiter, updateHistory, updateResult],
  );

  useTauriEvents({
    onQueryReady: handleQueryReady,
    onQueryError: handleQueryError,
    onQueryCancelled: handleQueryCancelled,
  });

  const waitForQuery = useCallback(
    (queryId: string) =>
      new Promise<QueryStatus>((resolve) => {
        waitersRef.current.set(queryId, resolve);
      }),
    [],
  );

  const runStatements = useCallback(
    async (sqlText: string, kind: 'query' | 'explain' = 'query') => {
      let tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;

      if (!tab.connectionId && activeConnectionId) {
        tab = { ...tab, connectionId: activeConnectionId };
        useEditorStore.setState({
          tabs: useEditorStore.getState().tabs.map((t) =>
            t.id === tab!.id ? tab! : t,
          ),
        });
      }

      const connectionId = tab.connectionId || activeConnectionId;
      if (!connectionId) return;

      const statements = splitSqlStatements(sqlText);
      if (statements.length === 0) return;

      const executableStatements =
        kind === 'explain'
          ? [{ sql: `EXPLAIN ${statements[0].sql.replace(/^EXPLAIN\s+/i, '')}`, startLine: statements[0].startLine }]
          : statements;
      const queryIds = executableStatements.map(() => crypto.randomUUID());
      updateQueryIds(tab.id, queryIds, 0);
      updateErrorLine(tab.id, undefined);

      for (let index = 0; index < executableStatements.length; index++) {
        const statement = executableStatements[index];
        const queryId = queryIds[index];
        const label =
          kind === 'explain'
            ? `EXPLAIN ${statementLabel(statement.sql.replace(/^EXPLAIN\s+/i, ''), 0, 1)}`
            : statementLabel(statement.sql, index, executableStatements.length);

        setResult(queryId, {
          query_id: queryId,
          columns: [],
          status: 'running',
          row_count: undefined,
          execution_time_ms: undefined,
          error: undefined,
          affected_rows: undefined,
          sql: statement.sql,
          label,
          kind,
          statement_index: index,
          statement_count: executableStatements.length,
          error_line: statement.startLine,
        });
        addHistory({
          id: historyId(queryId),
          sql: statement.sql,
          database: tab.database,
          connection_id: connectionId,
          created_at: Date.now(),
          status: 'running',
        });

        try {
          const waitPromise = waitForQuery(queryId);
          await executeQuery(connectionId, statement.sql, queryId);
          const status = await waitPromise;
          if (status === 'error' || status === 'cancelled') break;
        } catch (err) {
          waitersRef.current.delete(queryId);
          const error = String(err);
          updateResult(queryId, {
            status: 'error',
            error,
            error_line: statement.startLine,
          });
          updateHistory(historyId(queryId), { status: 'error', error });
          updateErrorLine(tab.id, statement.startLine);
          break;
        }
      }
    },
    [
      activeConnectionId,
      activeTabId,
      addHistory,
      setResult,
      tabs,
      updateErrorLine,
      updateHistory,
      updateQueryIds,
      updateResult,
      waitForQuery,
    ],
  );

  const runQuery = useCallback(
    async (sqlOverride?: string) => {
      const tab = tabs.find((t) => t.id === activeTabId);
      const sql = sqlOverride?.trim() || tab?.sql.trim();
      if (!tab || !sql) return;
      await runStatements(sql, 'query');
    },
    [activeTabId, runStatements, tabs],
  );

  const explainActiveSql = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab?.sql.trim()) return;
    await runStatements(tab.sql, 'explain');
  }, [activeTabId, runStatements, tabs]);

  const stopQuery = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    const runningIds = (tab?.queryIds?.length ? tab.queryIds : tab?.queryId ? [tab.queryId] : [])
      .filter((queryId) => useQueryStore.getState().results.get(queryId)?.status === 'running');
    await Promise.all(
      runningIds.map(async (queryId) => {
        try {
          await cancelQuery(queryId);
        } finally {
          updateResult(queryId, { status: 'cancelled' });
        }
      }),
    );
  }, [activeTabId, tabs, updateResult]);

  const formatActiveSql = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || !tab.sql.trim()) return;

    const formatted = await formatSql(tab.sql);
    updateSql(tab.id, formatted);
  }, [tabs, activeTabId, updateSql]);

  return { runQuery, stopQuery, formatActiveSql, explainActiveSql };
}
