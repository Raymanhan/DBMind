import { useUiStore } from '../../shared/stores/uiStore';
import { Database, FileText, Settings, Bot, ChevronLeft, ChevronRight } from 'lucide-react';

export function LeftRail() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const aiPanelOpen = useUiStore((s) => s.aiPanelOpen);
  const setAiPanelOpen = useUiStore((s) => s.setAiPanelOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  return (
    <div className="left-rail">
      <button className="rail-btn" onClick={() => setSidebarOpen(!sidebarOpen)} title="Toggle sidebar">
        {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
      </button>
      <button className="rail-btn active" title="Connections">
        <Database size={18} />
      </button>
      <button className="rail-btn" title="Query History">
        <FileText size={18} />
      </button>
      <button className="rail-btn" onClick={() => setSettingsOpen(true)} title="Settings">
        <Settings size={18} />
      </button>
      <div className="rail-spacer" />
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
