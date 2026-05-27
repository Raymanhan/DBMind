import { create } from 'zustand';

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
  theme: 'dark',
  sidebarOpen: true,
  aiPanelOpen: false,
  settingsOpen: false,
  sidebarWidth: 280,
  editorSplitPx: null,
  aiPanelWidth: 340,
  toggleTheme: () =>
    set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setEditorSplitPx: (px) => set({ editorSplitPx: px }),
  setAiPanelWidth: (width) => set({ aiPanelWidth: width }),
}));
