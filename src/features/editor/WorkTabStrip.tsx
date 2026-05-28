import { useState, useCallback, useRef, useEffect } from 'react';
import { useEditorStore } from '../../shared/stores/editorStore';
import { useConnectionStore } from '../../shared/stores/connectionStore';
import { X, Plus } from 'lucide-react';

interface ContextMenuState {
  x: number;
  y: number;
  tabId: string;
  tabIndex: number;
  totalTabs: number;
}

export function WorkTabStrip() {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const closeTabsToRight = useEditorStore((s) => s.closeTabsToRight);
  const closeTabsToLeft = useEditorStore((s) => s.closeTabsToLeft);
  const closeOtherTabs = useEditorStore((s) => s.closeOtherTabs);
  const closeAllTabs = useEditorStore((s) => s.closeAllTabs);
  const reorderTabs = useEditorStore((s) => s.reorderTabs);
  const newTab = useEditorStore((s) => s.newTab);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleNewTab = () => {
    if (activeConnectionId) {
      newTab(activeConnectionId, '');
    }
  };

  const handleClose = (tabId: string, dirty: boolean) => {
    if (dirty) {
      const confirmed = window.confirm('This tab has unsaved changes. Close anyway?');
      if (!confirmed) return;
    }
    closeTab(tabId);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string, tabIndex: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId, tabIndex, totalTabs: tabs.length });
  }, [tabs.length]);

  // Close context menu on outside click or scroll
  useEffect(() => {
    if (!contextMenu) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };

    const handleScroll = () => setContextMenu(null);
    const handleResize = () => setContextMenu(null);

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('resize', handleResize);
    };
  }, [contextMenu]);

  const hasRight = contextMenu && contextMenu.tabIndex < contextMenu.totalTabs - 1;
  const hasLeft = contextMenu && contextMenu.tabIndex > 0;
  const hasOthers = contextMenu && contextMenu.totalTabs > 1;

  return (
    <div
      className="work-tab-strip"
      ref={stripRef}
      onWheel={(e) => {
        if (stripRef.current) {
          stripRef.current.scrollLeft += e.deltaY;
        }
      }}
    >
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`work-tab ${tab.id === activeTabId ? 'active' : ''} ${dragIndex === index ? 'dragging' : ''}`}
          draggable
          onClick={() => setActiveTab(tab.id)}
          onContextMenu={(e) => handleContextMenu(e, tab.id, index)}
          onDragStart={() => setDragIndex(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIndex != null) reorderTabs(dragIndex, index);
            setDragIndex(null);
          }}
          onDragEnd={() => setDragIndex(null)}
          title={tab.database ? `${tab.database} — ${tab.title}` : tab.title}
        >
          {tab.database && <span className="tab-db">{tab.database}</span>}
          <span className="tab-title">{tab.title}</span>
          {tab.dirty && <span className="tab-dirty" />}
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              handleClose(tab.id, tab.dirty);
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        className="new-tab-btn"
        onClick={handleNewTab}
        disabled={!activeConnectionId}
        title={activeConnectionId ? 'New query tab (Cmd+T)' : 'Connect first'}
      >
        <Plus size={14} />
      </button>

      {contextMenu && (
        <div
          ref={menuRef}
          className="tab-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => { handleClose(contextMenu.tabId, tabs.find(t => t.id === contextMenu.tabId)?.dirty ?? false); setContextMenu(null); }}
          >
            Close
          </button>
          <button
            className="context-menu-item"
            disabled={!hasOthers}
            onClick={() => { closeOtherTabs(contextMenu.tabId); setContextMenu(null); }}
          >
            Close Others
          </button>
          <button
            className="context-menu-item"
            disabled={!hasLeft}
            onClick={() => { closeTabsToLeft(contextMenu.tabId); setContextMenu(null); }}
          >
            Close to Left
          </button>
          <button
            className="context-menu-item"
            disabled={!hasRight}
            onClick={() => { closeTabsToRight(contextMenu.tabId); setContextMenu(null); }}
          >
            Close to Right
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item"
            disabled={tabs.length === 0}
            onClick={() => { closeAllTabs(); setContextMenu(null); }}
          >
            Close All
          </button>
        </div>
      )}
    </div>
  );
}
