import { useCallback, useRef } from 'react';
import { LeftRail } from '../features/navigation/LeftRail';
import { Sidebar } from '../features/navigation/Sidebar';
import { TopBar } from '../features/editor/TopBar';
import { WorkTabStrip } from '../features/editor/WorkTabStrip';
import { SqlEditor } from '../features/editor/SqlEditor';
import { ResultGrid } from '../features/result-grid/ResultGrid';
import { AiPanel } from '../features/ai-chat/AiPanel';
import { SettingsModal } from '../features/settings/SettingsModal';
import { ResizeHandle } from '../shared/components/ResizeHandle';
import { useUiStore } from '../shared/stores/uiStore';

export function AppLayout() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const aiPanelOpen = useUiStore((s) => s.aiPanelOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUiStore((s) => s.setSidebarWidth);
  const editorSplitPx = useUiStore((s) => s.editorSplitPx);
  const setEditorSplitPx = useUiStore((s) => s.setEditorSplitPx);
  const aiPanelWidth = useUiStore((s) => s.aiPanelWidth);
  const setAiPanelWidth = useUiStore((s) => s.setAiPanelWidth);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const handleSidebarResize = useCallback(
    (delta: number) => {
      setSidebarWidth(Math.max(180, Math.min(600, sidebarWidth + delta)));
    },
    [sidebarWidth, setSidebarWidth],
  );

  const handleEditorResize = useCallback(
    (delta: number) => {
      const el = workspaceRef.current;
      if (!el) return;
      const topBarH = 36;
      const tabH = 32;
      const handleH = 5;
      const available = el.clientHeight - topBarH - tabH - handleH;
      const current = editorSplitPx ?? Math.round(available / 2);
      setEditorSplitPx(Math.max(80, Math.min(available - 80, current + delta)));
    },
    [editorSplitPx, setEditorSplitPx],
  );

  const handleEditorReset = useCallback(() => {
    setEditorSplitPx(null);
  }, [setEditorSplitPx]);

  const handleAiPanelResize = useCallback(
    (delta: number) => {
      setAiPanelWidth(Math.max(260, Math.min(700, aiPanelWidth - delta)));
    },
    [aiPanelWidth, setAiPanelWidth],
  );

  return (
    <div className="app-shell">
      <LeftRail />
      {sidebarOpen && (
        <>
          <div className="sidebar" style={{ width: sidebarWidth }}>
            <Sidebar />
          </div>
          <ResizeHandle direction="vertical" onResize={handleSidebarResize} />
        </>
      )}
      <div className="workspace" ref={workspaceRef}>
        <TopBar />
        <WorkTabStrip />
        <div
          className="editor-pane"
          style={editorSplitPx != null ? { height: editorSplitPx, flex: 'none' } : undefined}
        >
          <SqlEditor />
        </div>
        <ResizeHandle
          direction="horizontal"
          onResize={handleEditorResize}
          onDoubleClick={handleEditorReset}
        />
        <div className="result-pane">
          <ResultGrid />
        </div>
      </div>
      {aiPanelOpen && (
        <>
          <ResizeHandle direction="vertical" onResize={handleAiPanelResize} />
          <div className="ai-panel" style={{ width: aiPanelWidth, minWidth: 260 }}>
            <AiPanel />
          </div>
        </>
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
