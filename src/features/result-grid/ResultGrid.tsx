import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryStore } from '../../shared/stores/queryStore';
import { useEditorStore } from '../../shared/stores/editorStore';
import { fetchCells } from '../../shared/api/tauri';
import { DataGrid } from './DataGrid';
import type { CellValue, QueryResultMeta } from '../../shared/api/types';

function cellText(value: CellValue): string {
  if (value == null) return 'NULL';
  if (Array.isArray(value)) return `[${value.length} bytes]`;
  return String(value);
}

function ExplainSummary({ result }: { result: QueryResultMeta }) {
  const [rows, setRows] = useState<CellValue[][]>([]);

  useEffect(() => {
    if (result.status !== 'ready' || result.columns.length === 0) {
      setRows([]);
      return;
    }
    fetchCells(result.query_id, 0, Math.min(result.row_count ?? 0, 50), 0, result.columns.length)
      .then((block) => setRows(block.rows))
      .catch(() => setRows([]));
  }, [result]);

  if (rows.length === 0) return null;

  // Detect PostgreSQL EXPLAIN: single column named "QUERY PLAN"
  const colNames = result.columns.map((c) => c.name.toLowerCase());
  const isPgExplain = colNames.length === 1 && (colNames[0] === 'query plan' || colNames[0] === 'query_plan');

  if (isPgExplain) {
    return (
      <pre className="explain-text">
        {rows.map((row) => row[0] ? cellText(row[0]) : '').join('\n')}
      </pre>
    );
  }

  // MySQL-style structured EXPLAIN
  const indexByName = new Map(result.columns.map((column, index) => [column.name.toLowerCase(), index]));
  const pick = (row: CellValue[], name: string) => {
    const index = indexByName.get(name.toLowerCase());
    return index == null ? '' : cellText(row[index]);
  };

  return (
    <div className="explain-summary">
      {rows.map((row, index) => (
        <div className="explain-step" key={index}>
          <div className="explain-step-main">
            <span>{pick(row, 'select_type') || `Step ${index + 1}`}</span>
            <strong>{pick(row, 'table') || 'derived'}</strong>
            <span>{pick(row, 'type') || 'type n/a'}</span>
          </div>
          <div className="explain-step-meta">
            <span>key: {pick(row, 'key') || 'none'}</span>
            <span>rows: {pick(row, 'rows') || 'n/a'}</span>
            {pick(row, 'Extra') && <span>{pick(row, 'Extra')}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResultGrid() {
  const results = useQueryStore((s) => s.results);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveResultIndex = useEditorStore((s) => s.setActiveResultIndex);
  const tab = useEditorStore(
    (s) => s.tabs.find((t) => t.id === activeTabId) ?? null,
  );
  const queryIds = useMemo(
    () => (tab?.queryIds?.length ? tab.queryIds : tab?.queryId ? [tab.queryId] : []),
    [tab],
  );
  const activeIndex = Math.min(tab?.activeResultIndex ?? 0, Math.max(queryIds.length - 1, 0));
  const activeQueryId = queryIds[activeIndex];
  const activeResult = activeQueryId ? results.get(activeQueryId) ?? null : null;

  const handleFetchBlock = useCallback(
    async (
      queryId: string,
      rowStart: number,
      rowEnd: number,
      colStart: number,
      colEnd: number,
    ): Promise<{ rows: CellValue[][] }> => {
      try {
        const block = await fetchCells(queryId, rowStart, rowEnd, colStart, colEnd);
        return { rows: block.rows };
      } catch (err) {
        console.error('fetchCells failed:', err);
        return { rows: [] };
      }
    },
    [],
  );

  const completed = queryIds.filter((queryId) => {
    const status = results.get(queryId)?.status;
    return status === 'ready' || status === 'error' || status === 'cancelled';
  }).length;
  const running = queryIds.some((queryId) => results.get(queryId)?.status === 'running');

  if (!activeResult) {
    return (
      <div className="result-grid-empty">
        <p>Run a query to see results</p>
      </div>
    );
  }

  const columns = activeResult.columns ?? [];
  const totalRows = activeResult.row_count ?? 0;

  return (
    <div className="result-grid">
      {queryIds.length > 1 && (
        <div className="result-tabs">
          {queryIds.map((queryId, index) => {
            const result = results.get(queryId);
            return (
              <button
                key={queryId}
                className={`result-tab ${index === activeIndex ? 'active' : ''} ${result?.status ?? 'running'}`}
                onClick={() => tab && setActiveResultIndex(tab.id, index)}
                title={result?.sql}
              >
                {result?.label ?? `Statement ${index + 1}`}
              </button>
            );
          })}
          <span className="result-progress">
            {running ? `${completed}/${queryIds.length} complete` : `${queryIds.length}/${queryIds.length} complete`}
          </span>
        </div>
      )}

      <div className="result-meta">
        <span>{activeResult.label ?? 'Result'}</span>
        <span>{activeResult.status}</span>
        {activeResult.status === 'ready' && columns.length > 0 && <span>{totalRows} rows</span>}
        {activeResult.affected_rows != null && <span>{activeResult.affected_rows} rows affected</span>}
        {activeResult.execution_time_ms != null && <span>{activeResult.execution_time_ms}ms</span>}
      </div>

      {activeResult.status === 'running' && (
        <div className="result-grid-empty">
          <p>Running query...</p>
        </div>
      )}
      {activeResult.status === 'error' && (
        <div className="result-grid-empty">
          <p className="error-text">{activeResult.error ?? 'Unknown error'}</p>
        </div>
      )}
      {activeResult.status === 'cancelled' && (
        <div className="result-grid-empty">
          <p>Query cancelled</p>
        </div>
      )}
      {activeResult.status === 'ready' && activeResult.kind === 'explain' && (
        <ExplainSummary result={activeResult} />
      )}
      {activeResult.status === 'ready' && columns.length === 0 && (
        <div className="result-grid-empty">
          <p>Query completed</p>
        </div>
      )}
      {activeResult.status === 'ready' && columns.length > 0 && (
        <div className="result-grid-canvas">
          <DataGrid
            columns={columns}
            queryId={activeResult.query_id}
            totalRows={totalRows}
            fetchBlock={handleFetchBlock}
          />
        </div>
      )}
    </div>
  );
}
