import { create } from 'zustand';
import type { QueryHistoryItem, QueryResultMeta } from '../api/types';

interface QueryState {
  results: Map<string, QueryResultMeta>;
  history: QueryHistoryItem[];
  setResult: (queryId: string, meta: QueryResultMeta) => void;
  updateResult: (queryId: string, patch: Partial<QueryResultMeta>) => void;
  removeResult: (queryId: string) => void;
  clearResults: () => void;
  addHistory: (item: QueryHistoryItem) => void;
  updateHistory: (id: string, patch: Partial<QueryHistoryItem>) => void;
  clearHistory: () => void;
}

const HISTORY_KEY = 'dbmind-query-history';
const MAX_HISTORY = 200;

function loadHistory(): QueryHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistHistory(history: QueryHistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // Ignore localStorage failures.
  }
}

export const useQueryStore = create<QueryState>((set) => ({
  results: new Map(),
  history: loadHistory(),
  setResult: (queryId, meta) =>
    set((state) => {
      const results = new Map(state.results);
      results.set(queryId, meta);
      return { results };
    }),
  updateResult: (queryId, patch) =>
    set((state) => {
      const current = state.results.get(queryId);
      if (!current) return state;
      const results = new Map(state.results);
      results.set(queryId, { ...current, ...patch });
      return { results };
    }),
  removeResult: (queryId) =>
    set((state) => {
      const results = new Map(state.results);
      results.delete(queryId);
      return { results };
    }),
  clearResults: () => set({ results: new Map() }),
  addHistory: (item) =>
    set((state) => {
      const history = [item, ...state.history.filter((h) => h.id !== item.id)].slice(0, MAX_HISTORY);
      persistHistory(history);
      return { history };
    }),
  updateHistory: (id, patch) =>
    set((state) => {
      const history = state.history.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      );
      persistHistory(history);
      return { history };
    }),
  clearHistory: () => {
    persistHistory([]);
    set({ history: [] });
  },
}));
