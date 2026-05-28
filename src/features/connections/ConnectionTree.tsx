import { useState, useEffect, useCallback } from 'react';
import { useConnectionStore } from '../../shared/stores/connectionStore';
import { useEditorStore } from '../../shared/stores/editorStore';
import {
  connect,
  deleteConnection,
  disconnect,
  listConnections,
  listDatabases,
} from '../../shared/api/tauri';
import { ConnectionForm } from './ConnectionForm';
import {
  Database,
  Loader2,
  Plus,
  Trash2,
  Play,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import type { ConnectionConfig } from '../../shared/api/types';

const SYSTEM_DATABASES = new Set([
  'information_schema',
  'mysql',
  'performance_schema',
  'sys',
]);

function pickDefaultDatabase(
  databases: string[],
  preferred?: string,
): string {
  if (preferred && databases.includes(preferred)) return preferred;
  return databases.find((db) => !SYSTEM_DATABASES.has(db)) ?? databases[0] ?? '';
}

export function ConnectionTree() {
  const connections = useConnectionStore((s) => s.connections);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const setActiveConnection = useConnectionStore((s) => s.setActiveConnection);
  const addConnection = useConnectionStore((s) => s.addConnection);
  const removeConnection = useConnectionStore((s) => s.removeConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const connectedIds = useConnectionStore((s) => s.connectedIds);
  const markConnected = useConnectionStore((s) => s.markConnected);
  const markDisconnected = useConnectionStore((s) => s.markDisconnected);
  const selectedDatabases = useConnectionStore((s) => s.selectedDatabases);
  const databasesByConn = useConnectionStore((s) => s.databasesByConn);
  const setDatabasesForConnection = useConnectionStore((s) => s.setDatabasesForConnection);
  const toggleDatabase = useConnectionStore((s) => s.toggleDatabase);
  const newTab = useEditorStore((s) => s.newTab);

  const [showForm, setShowForm] = useState(false);
  const [loadingConnectionId, setLoadingConnectionId] = useState<string | null>(null);
  const [connectionErrors, setConnectionErrors] = useState<Record<string, string>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    listConnections()
      .then((configs) => {
        configs.forEach((c) => addConnection(c));
      })
      .catch(console.error);
  }, [addConnection]);

  const activateConnection = useCallback(
    async (config: ConnectionConfig) => {
      setLoadingConnectionId(config.id);
      setConnectionErrors((prev) => {
        const next = { ...prev };
        delete next[config.id];
        return next;
      });

      try {
        await connect(config);
        markConnected(config.id);
        const databaseList = await listDatabases(config.id);
        setDatabasesForConnection(config.id, databaseList);

        const database = pickDefaultDatabase(databaseList, config.database);
        const nextConfig = { ...config, database: database || config.database };
        updateConnection(nextConfig);
        if (nextConfig.database && nextConfig.database !== config.database) {
          disconnect(config.id).catch(console.error);
          connect(nextConfig).catch(console.error);
        }
        setActiveConnection(config.id);

        if (nextConfig.database) {
          newTab(config.id, nextConfig.database);
        }

        // Auto-expand after connecting
        setExpandedIds((prev) => {
          const next = new Set(prev);
          next.add(config.id);
          return next;
        });
      } catch (error) {
        setConnectionErrors((prev) => ({
          ...prev,
          [config.id]: String(error),
        }));
      } finally {
        setLoadingConnectionId(null);
      }
    },
    [newTab, setActiveConnection, updateConnection, markConnected, setDatabasesForConnection],
  );

  const handleConnected = useCallback(
    (config: ConnectionConfig) => {
      addConnection(config);
      activateConnection(config);
      setShowForm(false);
    },
    [activateConnection, addConnection],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      setActiveConnection(id);
    },
    [setActiveConnection],
  );

  const handleConnect = useCallback(
    (id: string) => {
      const conn = connections.find((c) => c.id === id);
      if (conn) {
        activateConnection(conn);
      }
    },
    [activateConnection, connections],
  );

  const handleCheckboxChange = useCallback(
    (connId: string, database: string) => {
      setActiveConnection(connId);
      toggleDatabase(connId, database);
    },
    [setActiveConnection, toggleDatabase],
  );

  const handleDelete = useCallback(
    (id: string) => {
      disconnect(id).catch(console.error);
      deleteConnection(id).catch(console.error);
      removeConnection(id);
      markDisconnected(id);
      setDeleteConfirmId(null);
    },
    [removeConnection, markDisconnected],
  );

  return (
    <div className="connection-tree">
      <div className="tree-header">
        <span className="tree-title">Connections</span>
        <button
          className="tree-action"
          title="Add connection"
          onClick={() => setShowForm(true)}
        >
          <Plus size={14} />
        </button>
      </div>

      {connections.length === 0 ? (
        <div className="tree-empty">No connections yet</div>
      ) : (
        <ul className="tree-list">
          {connections.map((conn) => {
            const isExpanded = expandedIds.has(conn.id);
            const isConnected = connectedIds.has(conn.id);
            const connDatabases = databasesByConn[conn.id] ?? [];
            const selected = selectedDatabases[conn.id] ?? new Set<string>();

            return (
              <li key={conn.id}>
                <div
                  className={`tree-item ${conn.id === activeConnectionId ? 'active' : ''}`}
                  onClick={() => handleSelect(conn.id)}
                  onDoubleClick={() => handleConnect(conn.id)}
                  title={`${conn.name} — ${conn.host}:${conn.port}`}
                >
                  {/* Expand/collapse chevron */}
                  <span
                    className="toggle-chevron"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(conn.id);
                    }}
                  >
                    {isConnected && connDatabases.length > 0 ? (
                      isExpanded ? (
                        <ChevronDown size={12} />
                      ) : (
                        <ChevronRight size={12} />
                      )
                    ) : (
                      <span style={{ width: 12, display: 'inline-block' }} />
                    )}
                  </span>

                  <span
                    className={`conn-status-dot ${isConnected ? 'connected' : ''}`}
                  />
                  <span className="conn-name">{conn.name}</span>
                  <span className="conn-host">
                    {conn.host}:{conn.port}
                  </span>
                  {loadingConnectionId === conn.id && (
                    <Loader2 size={12} className="spin" />
                  )}
                  {!(loadingConnectionId === conn.id) && !isConnected && (
                    <button
                      className="conn-play"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConnect(conn.id);
                      }}
                      title="Connect (or double-click)"
                    >
                      <Play size={12} />
                    </button>
                  )}
                  {deleteConfirmId === conn.id ? (
                    <div className="delete-confirm">
                      <button
                        className="delete-confirm-yes"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(conn.id);
                        }}
                      >
                        Delete
                      </button>
                      <button
                        className="delete-confirm-no"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="conn-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(conn.id);
                      }}
                      title="Remove"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {connectionErrors[conn.id] && (
                  <div className="tree-error">{connectionErrors[conn.id]}</div>
                )}

                {/* Expanded database list with checkboxes */}
                {isExpanded && isConnected && connDatabases.length > 0 && (
                  <ul className="tree-sublist">
                    {connDatabases.map((database) => (
                      <li
                        key={database}
                        className={`tree-item schema-column db-checkbox-row ${
                          selected.has(database) ? 'selected' : ''
                        }`}
                        title={database}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCheckboxChange(conn.id, database);
                        }}
                      >
                        <input
                          type="checkbox"
                          className="db-checkbox"
                          checked={selected.has(database)}
                          onChange={() => handleCheckboxChange(conn.id, database)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <Database size={12} />
                        <span className="col-name">{database}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {showForm && (
        <ConnectionForm
          onClose={() => setShowForm(false)}
          onConnected={handleConnected}
        />
      )}
    </div>
  );
}
