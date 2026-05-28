import { create } from 'zustand';

function loadTheme(): 'light' | 'dark' {
  try {
    const stored = localStorage.getItem('dbmind-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    // Respect system preference
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch {}
  return 'dark';
}

interface UiState {
  theme: 'light' | 'dark';
  sidebarOpen: boolean;
  aiPanelOpen: boolean;
  settingsOpen: boolean;
  sidebarWidth: number;
  editorSplitPx: number | null;
  aiPanelWidth: number;
  toggleTheme: () => void;
  setSidebarOpen: (open: boolean) => void;
  setAiPanelOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setEditorSplitPx: (px: number | null) => void;
  setAiPanelWidth: (width: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  theme: loadTheme(),
  sidebarOpen: true,
  aiPanelOpen: true,
  settingsOpen: false,
  sidebarWidth: 280,
  editorSplitPx: null,
  aiPanelWidth: 340,
  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('dbmind-theme', next); } catch {}
      return { theme: next };
    }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setEditorSplitPx: (px) => set({ editorSplitPx: px }),
  setAiPanelWidth: (width) => set({ aiPanelWidth: width }),
}));
