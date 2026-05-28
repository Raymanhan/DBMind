import { create } from 'zustand';
import type { AiConfig, AiConnection } from '../api/types';

const STORAGE_KEY = 'dbmind-settings';

const DEFAULT_CONNECTION: AiConnection = {
  id: 'default',
  name: 'Default',
  provider: 'compatible',
  api_key: undefined,
  api_url: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-flash',
  max_tokens: 4096,
  temperature: 0.1,
};

const defaults: AiConfig = {
  connections: [{ ...DEFAULT_CONNECTION }],
  activeId: 'default',
};

function loadPersisted(): AiConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.connections && Array.isArray(parsed.connections)) {
      return { ...defaults, ...parsed };
    }
    // Migrate legacy single-config format
    return defaults;
  } catch {
    return defaults;
  }
}

let persistRaf = 0;
function persist(config: AiConfig) {
  cancelAnimationFrame(persistRaf);
  persistRaf = requestAnimationFrame(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  });
}

interface SettingsState {
  ai: AiConfig;
  activeConnection: () => AiConnection | undefined;
  setActiveId: (id: string) => void;
  addConnection: (conn: AiConnection) => void;
  updateConnection: (id: string, patch: Partial<AiConnection>) => void;
  deleteConnection: (id: string) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ai: loadPersisted(),

  activeConnection: () => {
    const { connections, activeId } = get().ai;
    return connections.find((c) => c.id === activeId) ?? connections[0];
  },

  setActiveId: (id: string) =>
    set((state) => {
      const ai = { ...state.ai, activeId: id };
      persist(ai);
      return { ai };
    }),

  addConnection: (conn: AiConnection) =>
    set((state) => {
      const ai = {
        ...state.ai,
        connections: [...state.ai.connections, conn],
        activeId: conn.id,
      };
      persist(ai);
      return { ai };
    }),

  updateConnection: (id: string, patch: Partial<AiConnection>) =>
    set((state) => {
      const connections = state.ai.connections.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      );
      const ai = { ...state.ai, connections };
      persist(ai);
      return { ai };
    }),

  deleteConnection: (id: string) =>
    set((state) => {
      if (state.ai.connections.length <= 1) return state;
      const connections = state.ai.connections.filter((c) => c.id !== id);
      const activeId = state.ai.activeId === id ? connections[0].id : state.ai.activeId;
      const ai = { connections, activeId };
      persist(ai);
      return { ai };
    }),
}));
