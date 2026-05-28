import { useEffect, useState, useCallback } from 'react';
import { useConnectionStore } from '../../shared/stores/connectionStore';
import { useEditorStore } from '../../shared/stores/editorStore';
import { useQueryStore } from '../../shared/stores/queryStore';
import { executeQuery, refreshSchema, getSchema } from '../../shared/api/tauri';
import type { TableSchema } from '../../shared/api/types';
import {
  Loader2,
  Table,
  Columns,
  ChevronRight,
  ChevronDown,
  Database,
} from 'lucide-react';

interface DbSchema {
  loading: boolean;
  error: string | null;
  tables: TableSchema[];
}

export function SchemaTree() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const connections = useConnectionStore((s) => s.connections);
  const connectedIds = useConnectionStore((s) => s.connectedIds);
  const selectedDatabases = useConnectionStore((s) => s.selectedDatabases);
  const openTab = useEditorStore((s) => s.openTab);

  // Per-database schema cache
  const [schemas, setSchemas] = useState<Record<string, DbSchema>>({});
  // Expanded nodes: "db", "db.table"
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const activeConn = connections.find((c) => c.id === activeConnectionId);
  const isConnected =
    activeConnectionId != null && connectedIds.has(activeConnectionId);

  // Gather the selected databases for the active connection
  const selected =
    activeConnectionId != null
      ? Array.from(selectedDatabases[activeConnectionId] ?? [])
      : [];

  // Load schemas for selected databases
  useEffect(() => {
    if (!activeConnectionId || !isConnected || selected.length === 0) {
      setSchemas({});
      return;
    }

    selected.forEach((database) => {
      setSchemas((prev) => {
        if (prev[database]) return prev; // already loaded or loading
        return {
          ...prev,
          [database]: { loading: true, error: null, tables: [] },
        };
      });

      refreshSchema(activeConnectionId, database)
        .then(() => getSchema(database))
        .then((tables) => {
          setSchemas((prev) => ({
            ...prev,
            [database]: { loading: false, error: null, tables },
          }));
        })
        .catch((e) => {
          setSchemas((prev) => ({
            ...prev,
            [database]: { loading: false, error: String(e), tables: [] },
          }));
        });
    });

    // Clean up schemas for unselected databases
    setSchemas((prev) => {
      const next: Record<string, DbSchema> = {};
      for (const db of selected) {
        if (prev[db]) next[db] = prev[db];
      }
      return next;
    });
  }, [activeConnectionId, isConnected, selected.join(',')]);

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleOpenTable = useCallback(
    (database: string, table: string) => {
      if (!activeConnectionId) return;

      const isPostgres = activeConn?.driver === 'postgres';
      const sql = isPostgres
        ? `SELECT *\nFROM "${table}"\nLIMIT 100;`
        : `SELECT *\nFROM \`${database}\`.\`${table}\`\nLIMIT 100;`;
      const tabId = crypto.randomUUID();
      const queryId = crypto.randomUUID();
      openTab({
        id: tabId,
        title: `${database}.${table}`,
        sql,
        connectionId: activeConnectionId,
        database,
        dirty: false,
        queryId,
      });

      useEditorStore.getState().updateQueryId(tabId, queryId);
      useQueryStore.getState().setResult(queryId, {
        query_id: queryId,
        columns: [],
        status: 'running',
        row_count: undefined,
        execution_time_ms: undefined,
        error: undefined,
        affected_rows: undefined,
      });

      executeQuery(activeConnectionId, sql, queryId).catch((err) => {
        useQueryStore.getState().updateResult(queryId, {
          status: 'error',
          error: String(err),
        });
      });
    },
    [activeConnectionId, openTab],
  );

  if (!activeConnectionId || !isConnected) {
    return (
      <div className="schema-tree">
        <div className="tree-header">
          <span className="tree-title">Schema</span>
        </div>
        <div className="tree-empty">Connect to a database first</div>
      </div>
    );
  }

  if (selected.length === 0) {
    return (
      <div className="schema-tree">
        <div className="tree-header">
          <span className="tree-title">Schema</span>
        </div>
        <div className="tree-empty">
          Select databases from the connection panel
        </div>
      </div>
    );
  }

  const totalTables = Object.values(schemas).reduce(
    (sum, s) => sum + s.tables.length,
    0,
  );

  return (
    <div className="schema-tree">
      <div className="tree-header">
        <span className="tree-title">Schema</span>
        <span className="tree-count">
          {selected.length} db{selected.length !== 1 ? 's' : ''} · {totalTables}{' '}
          table{totalTables !== 1 ? 's' : ''}
        </span>
      </div>

      <ul className="tree-list">
        {selected.map((database) => {
          const dbSchema = schemas[database];
          const dbKey = database;
          const isDbExpanded = expanded.has(dbKey);

          return (
            <li key={database}>
              {/* Database node */}
              <div
                className="tree-item schema-database"
                onClick={() => toggleExpand(dbKey)}
              >
                <span className="toggle-chevron">
                  {isDbExpanded ? (
                    <ChevronDown size={12} />
                  ) : (
                    <ChevronRight size={12} />
                  )}
                </span>
                <Database size={14} />
                <span className="conn-name">{database}</span>
                {dbSchema?.loading && <Loader2 size={12} className="spin" />}
                {!dbSchema?.loading && dbSchema?.tables && (
                  <span className="conn-host">
                    {dbSchema.tables.length} tables
                  </span>
                )}
              </div>

              {dbSchema?.error && (
                <div className="tree-error">{dbSchema.error}</div>
              )}

              {/* Tables under this database */}
              {isDbExpanded && dbSchema && !dbSchema.loading && (
                <ul className="tree-sublist">
                  {dbSchema.tables.map((tbl) => {
                    const tableKey = `${database}.${tbl.table}`;
                    const isTableExpanded = expanded.has(tableKey);

                    return (
                      <li key={tbl.table}>
                        <div
                          className="tree-item schema-table"
                          onDoubleClick={() =>
                            handleOpenTable(database, tbl.table)
                          }
                        >
                          <span
                            className="toggle-chevron"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(tableKey);
                            }}
                          >
                            {isTableExpanded ? (
                              <ChevronDown size={12} />
                            ) : (
                              <ChevronRight size={12} />
                            )}
                          </span>
                          <Table size={14} />
                          <span className="conn-name">{tbl.table}</span>
                          {tbl.row_count != null && (
                            <span className="conn-host">
                              {tbl.row_count.toLocaleString()}
                            </span>
                          )}
                        </div>

                        {/* Columns under this table */}
                        {isTableExpanded && (
                          <ul className="tree-sublist">
                            {tbl.columns.map((col) => (
                              <li
                                key={col.name}
                                className="tree-item schema-column"
                              >
                                <Columns size={12} />
                                <span className="col-name">{col.name}</span>
                                <span className="col-type">{col.data_type}</span>
                                {col.is_primary_key && (
                                  <span className="col-pk">PK</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
