import { create } from 'zustand';
import type { ConnectionConfig } from '../api/types';

interface ConnectionState {
  connections: ConnectionConfig[];
  activeConnectionId: string | null;
  connectedIds: Set<string>;
  selectedDatabases: Record<string, Set<string>>;
  databasesByConn: Record<string, string[]>;
  setActiveConnection: (id: string | null) => void;
  markConnected: (id: string) => void;
  markDisconnected: (id: string) => void;
  addConnection: (config: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  updateConnection: (config: ConnectionConfig) => void;
  toggleDatabase: (connectionId: string, database: string) => void;
  setSelectedDatabases: (connectionId: string, databases: Set<string>) => void;
  setDatabasesForConnection: (connectionId: string, databases: string[]) => void;
}

// ─── Persistence helpers ────────────────────────────────
const STORAGE_KEY_SELECTED = 'dbmind-selected-databases';
const STORAGE_KEY_DATABASES = 'dbmind-databases-by-conn';

/** Serialize Record<string, Set<string>> to JSON (Sets → arrays) */
function serializeSelected(data: Record<string, Set<string>>): string {
  const plain: Record<string, string[]> = {};
  for (const [key, set] of Object.entries(data)) {
    plain[key] = [...set];
  }
  return JSON.stringify(plain);
}

/** Deserialize JSON back to Record<string, Set<string>> */
function deserializeSelected(json: string | null): Record<string, Set<string>> {
  if (!json) return {};
  try {
    const plain = JSON.parse(json) as Record<string, string[]>;
    const result: Record<string, Set<string>> = {};
    for (const [key, arr] of Object.entries(plain)) {
      result[key] = new Set(arr);
    }
    return result;
  } catch {
    return {};
  }
}

function persistSelected(data: Record<string, Set<string>>) {
  try {
    localStorage.setItem(STORAGE_KEY_SELECTED, serializeSelected(data));
  } catch { /* quota exceeded, silently ignore */ }
}

function persistDatabases(data: Record<string, string[]>) {
  try {
    localStorage.setItem(STORAGE_KEY_DATABASES, JSON.stringify(data));
  } catch { /* ignore */ }
}

function loadSelected(): Record<string, Set<string>> {
  return deserializeSelected(localStorage.getItem(STORAGE_KEY_SELECTED));
}

function loadDatabases(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DATABASES);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ─── Store ──────────────────────────────────────────────
export const useConnectionStore = create<ConnectionState>((set) => ({
  connections: [],
  activeConnectionId: null,
  connectedIds: new Set(),
  selectedDatabases: loadSelected(),
  databasesByConn: loadDatabases(),

  setActiveConnection: (id) => set({ activeConnectionId: id }),

  markConnected: (id) =>
    set((state) => {
      const next = new Set(state.connectedIds);
      next.add(id);
      return { connectedIds: next };
    }),

  markDisconnected: (id) =>
    set((state) => {
      const next = new Set(state.connectedIds);
      next.delete(id);
      return { connectedIds: next };
    }),

  addConnection: (config) =>
    set((state) => ({
      connections: state.connections.some((c) => c.id === config.id)
        ? state.connections.map((c) => (c.id === config.id ? config : c))
        : [...state.connections, config],
    })),

  removeConnection: (id) =>
    set((state) => {
      // Clean up persisted data for removed connection
      const { [id]: _sel, ...restSelected } = state.selectedDatabases;
      const { [id]: _dbs, ...restDatabases } = state.databasesByConn;
      persistSelected(restSelected);
      persistDatabases(restDatabases);
      return {
        connections: state.connections.filter((c) => c.id !== id),
        activeConnectionId:
          state.activeConnectionId === id ? null : state.activeConnectionId,
        connectedIds: (() => {
          const next = new Set(state.connectedIds);
          next.delete(id);
          return next;
        })(),
        selectedDatabases: restSelected,
        databasesByConn: restDatabases,
      };
    }),

  updateConnection: (config) =>
    set((state) => ({
      connections: state.connections.map((c) =>
        c.id === config.id ? config : c
      ),
    })),

  toggleDatabase: (connectionId, database) =>
    set((state) => {
      const current = state.selectedDatabases[connectionId] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(database)) next.delete(database);
      else next.add(database);
      const updated = { ...state.selectedDatabases, [connectionId]: next };
      persistSelected(updated);
      return { selectedDatabases: updated };
    }),

  setSelectedDatabases: (connectionId, databases) =>
    set((state) => {
      const updated = { ...state.selectedDatabases, [connectionId]: databases };
      persistSelected(updated);
      return { selectedDatabases: updated };
    }),

  setDatabasesForConnection: (connectionId, databases) =>
    set((state) => {
      const updated = { ...state.databasesByConn, [connectionId]: databases };
      persistDatabases(updated);
      return { databasesByConn: updated };
    }),
}));
