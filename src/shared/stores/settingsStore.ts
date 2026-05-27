import { create } from 'zustand';
import type { AiConfig, AiProvider } from '../api/types';

interface SettingsState {
  ai: AiConfig;
  setAi: (config: Partial<AiConfig>) => void;
}

const STORAGE_KEY = 'dbmind-settings';

function loadPersisted(): Partial<AiConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persist(ai: AiConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ai));
}

const defaults: AiConfig = {
  provider: 'openai',
  api_key: undefined,
  api_url: undefined,
  model: 'gpt-4o-mini',
  max_tokens: 4096,
  temperature: 0.7,
};

const initial = { ...defaults, ...loadPersisted() };

export const useSettingsStore = create<SettingsState>((set) => ({
  ai: initial,
  setAi: (patch) =>
    set((state) => {
      const ai = { ...state.ai, ...patch };
      persist(ai);
      return { ai };
    }),
}));
