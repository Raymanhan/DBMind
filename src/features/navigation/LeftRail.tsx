import { useUiStore } from '../../shared/stores/uiStore';
import { Settings, Bot, ChevronLeft, ChevronRight, Sun, Moon } from 'lucide-react';

export function LeftRail() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const aiPanelOpen = useUiStore((s) => s.aiPanelOpen);
  const setAiPanelOpen = useUiStore((s) => s.setAiPanelOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const theme = useUiStore((s) => s.theme);
  const toggleTheme = useUiStore((s) => s.toggleTheme);

  return (
    <div className="left-rail">
      <button className="rail-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar">
        {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>

      <button className="rail-btn" onClick={() => setSettingsOpen(true)} title="Settings">
        <Settings size={18} />
      </button>
      <div className="rail-spacer" />
      <button
        className="rail-btn"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      <button
        className={`rail-btn ${aiPanelOpen ? 'active' : ''}`}
        onClick={() => setAiPanelOpen(!aiPanelOpen)}
        title="AI Assistant"
      >
        <Bot size={18} />
      </button>
    </div>
  );
}
