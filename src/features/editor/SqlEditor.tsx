import { useCallback } from 'react';
import { useEditorStore } from '../../shared/stores/editorStore';
import { useQueryExecution } from '../../shared/hooks/useQueryExecution';
import { MonacoEditor } from './MonacoEditor';

export function SqlEditor() {
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const updateSql = useEditorStore((s) => s.updateSql);
  const tab = useEditorStore((s) =>
    s.tabs.find((t) => t.id === activeTabId) ?? null,
  );
  const { runQuery } = useQueryExecution();

  const handleExecute = useCallback((sql?: string) => {
    runQuery(sql);
  }, [runQuery]);

  if (!activeTabId || !tab) {
    return (
      <div className="sql-editor-empty">
        <p>Open a query tab to start editing SQL</p>
      </div>
    );
  }

  return (
    <div className="sql-editor" data-tab={activeTabId}>
      <MonacoEditor
        value={tab.sql}
        database={tab.database}
        errorLine={tab.errorLine}
        onChange={(sql) => updateSql(activeTabId, sql)}
        onExecute={handleExecute}
      />
    </div>
  );
}
