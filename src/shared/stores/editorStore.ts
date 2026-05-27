import { create } from 'zustand';

export interface EditorTab {
  id: string;
  title: string;
  sql: string;
  connectionId: string;
  database: string;
  dirty: boolean;
  queryId?: string;
  queryIds?: string[];
  activeResultIndex?: number;
  errorLine?: number;
}

/** Extract a short label from SQL for tab title */
function sqlToLabel(sql: string): string {
  if (!sql.trim()) return '';
  const firstLine = sql.trim().split('\n')[0].trim();
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine;
}

interface EditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
  newTab: (connectionId: string, database: string) => void;
  setActiveTab: (id: string | null) => void;
  openTab: (tab: EditorTab) => void;
  closeTab: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  closeOtherTabs: (keepId: string) => void;
  closeTabsToRight: (id: string) => void;
  closeTabsToLeft: (id: string) => void;
  closeAllTabs: () => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateSql: (id: string, sql: string) => void;
  updateQueryId: (id: string, queryId: string) => void;
  updateQueryIds: (id: string, queryIds: string[], activeResultIndex?: number) => void;
  setActiveResultIndex: (id: string, index: number) => void;
  updateTabDatabase: (id: string, connectionId: string, database: string) => void;
  updateErrorLine: (id: string, errorLine?: number) => void;
}

let tabCounter = 0;

const STORAGE_KEY = 'dbmind-editor-tabs';

interface PersistedEditorState {
  tabs: EditorTab[];
  activeTabId: string | null;
}

function stripRuntimeFields(tab: EditorTab): EditorTab {
  return {
    ...tab,
    queryId: undefined,
    queryIds: [],
    activeResultIndex: 0,
    errorLine: undefined,
  };
}

function loadEditorState(): PersistedEditorState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { tabs: [], activeTabId: null };
    const parsed = JSON.parse(raw) as PersistedEditorState;
    const tabs = (parsed.tabs ?? []).map(stripRuntimeFields);
    return {
      tabs,
      activeTabId: tabs.some((tab) => tab.id === parsed.activeTabId)
        ? parsed.activeTabId
        : tabs[0]?.id ?? null,
    };
  } catch {
    return { tabs: [], activeTabId: null };
  }
}

function persistEditorState(tabs: EditorTab[], activeTabId: string | null) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ tabs: tabs.map(stripRuntimeFields), activeTabId }),
    );
  } catch {
    // Ignore localStorage quota/private-mode errors.
  }
}

const initialState = loadEditorState();
tabCounter = initialState.tabs.reduce((max, tab) => {
  const match = tab.title.match(/^Query (\d+)$/);
  return match ? Math.max(max, Number(match[1])) : max;
}, initialState.tabs.length);

export const useEditorStore = create<EditorState>((set) => ({
  tabs: initialState.tabs,
  activeTabId: initialState.activeTabId,

  newTab: (connectionId, database) =>
    set((state) => {
      tabCounter = Math.max(tabCounter, state.tabs.length) + 1;
      const tab: EditorTab = {
        id: crypto.randomUUID(),
        title: `Query ${tabCounter}`,
        sql: '',
        connectionId,
        database,
        dirty: false,
        queryIds: [],
        activeResultIndex: 0,
      };
      const tabs = [...state.tabs, tab];
      persistEditorState(tabs, tab.id);
      return {
        tabs,
        activeTabId: tab.id,
      };
    }),

  setActiveTab: (id) =>
    set((state) => {
      persistEditorState(state.tabs, id);
      return { activeTabId: id };
    }),

  openTab: (tab) =>
    set((state) => {
      const existing = state.tabs.find((t) => t.id === tab.id);
      if (existing) {
        persistEditorState(state.tabs, tab.id);
        return { activeTabId: tab.id };
      }
      const nextTab = { queryIds: [], activeResultIndex: 0, ...tab };
      const tabs = [...state.tabs, nextTab];
      persistEditorState(tabs, nextTab.id);
      return {
        tabs,
        activeTabId: nextTab.id,
      };
    }),

  closeTab: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== id);
      const activeTabId =
        state.activeTabId === id
          ? tabs.length > 0
            ? tabs[tabs.length - 1].id
            : null
          : state.activeTabId;
      persistEditorState(tabs, activeTabId);
      return { tabs, activeTabId };
    }),

  closeTabs: (ids) =>
    set((state) => {
      const idSet = new Set(ids);
      const tabs = state.tabs.filter((t) => !idSet.has(t.id));
      const activeTabId = idSet.has(state.activeTabId ?? '')
        ? tabs.length > 0
          ? tabs[tabs.length - 1].id
          : null
        : state.activeTabId;
      persistEditorState(tabs, activeTabId);
      return { tabs, activeTabId };
    }),

  closeOtherTabs: (keepId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id === keepId);
      persistEditorState(tabs, keepId);
      return { tabs, activeTabId: keepId };
    }),

  closeTabsToRight: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;
      const tabs = state.tabs.slice(0, index + 1);
      const activeTabId = tabs.some((t) => t.id === state.activeTabId)
        ? state.activeTabId
        : tabs[tabs.length - 1].id;
      persistEditorState(tabs, activeTabId);
      return { tabs, activeTabId };
    }),

  closeTabsToLeft: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((t) => t.id === id);
      if (index === -1) return state;
      const tabs = state.tabs.slice(index);
      const activeTabId = tabs.some((t) => t.id === state.activeTabId)
        ? state.activeTabId
        : tabs[0].id;
      persistEditorState(tabs, activeTabId);
      return { tabs, activeTabId };
    }),

  closeAllTabs: () => {
    persistEditorState([], null);
    return set({ tabs: [], activeTabId: null });
  },

  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= state.tabs.length ||
        toIndex >= state.tabs.length
      ) {
        return state;
      }
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, moved);
      persistEditorState(tabs, state.activeTabId);
      return { tabs };
    }),

  updateSql: (id, sql) =>
    set((state) => {
      const tabs = state.tabs.map((t) => {
        if (t.id !== id) return t;
        const label = sqlToLabel(sql);
        const isGeneratedTitle = /^Query \d+$/.test(t.title);
        return {
          ...t,
          sql,
          dirty: true,
          title: label && isGeneratedTitle ? label : t.title,
          errorLine: undefined,
        };
      });
      persistEditorState(tabs, state.activeTabId);
      return { tabs };
    }),

  updateQueryId: (id, queryId) =>
    set((state) => {
      const tabs = state.tabs.map((t) =>
        t.id === id
          ? { ...t, queryId, queryIds: [queryId], activeResultIndex: 0, errorLine: undefined }
          : t,
      );
      return { tabs };
    }),

  updateQueryIds: (id, queryIds, activeResultIndex = 0) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              queryId: queryIds[activeResultIndex] ?? queryIds[0],
              queryIds,
              activeResultIndex,
              errorLine: undefined,
            }
          : t,
      ),
    })),

  setActiveResultIndex: (id, index) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? { ...t, activeResultIndex: index, queryId: t.queryIds?.[index] ?? t.queryId }
          : t,
      ),
    })),

  updateTabDatabase: (id, connectionId, database) =>
    set((state) => {
      const tabs = state.tabs.map((t) =>
        t.id === id ? { ...t, connectionId, database } : t,
      );
      persistEditorState(tabs, state.activeTabId);
      return { tabs };
    }),

  updateErrorLine: (id, errorLine) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, errorLine } : t)),
    })),
}));
