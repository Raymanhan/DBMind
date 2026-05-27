import { useState, useCallback } from 'react';
import { Play, Copy, Check } from 'lucide-react';
import type { EditorTab } from '../../shared/stores/editorStore';
import { useEditorStore } from '../../shared/stores/editorStore';
import { useConnectionStore } from '../../shared/stores/connectionStore';
import { useQueryExecution } from '../../shared/hooks/useQueryExecution';

const SQL_KEYWORDS = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|IS|NULL|AS|GROUP|BY|ORDER|ASC|DESC|HAVING|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|TABLE|ALTER|DROP|INDEX|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|EXISTS|BETWEEN|LIKE|COUNT|SUM|AVG|MIN|MAX|CAST|COALESCE|IF|IFNULL|CONCAT|SUBSTRING|TRIM|UPPER|LOWER|LENGTH|DATE|NOW|PRIMARY|KEY|FOREIGN|REFERENCES|DEFAULT|AUTO_INCREMENT|UNSIGNED|INT|BIGINT|VARCHAR|TEXT|CHAR|BOOLEAN|FLOAT|DOUBLE|DECIMAL|DATE|DATETIME|TIMESTAMP|BLOB|JSON|ENUM)\b/gi;
const SQL_STRINGS = /'[^']*'/g;
const SQL_NUMBERS = /\b\d+(\.\d+)?\b/g;

function highlightSql(sql: string): string {
  let html = sql
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(SQL_STRINGS, (m) => `<span class="sql-string">${m}</span>`);
  html = html.replace(SQL_KEYWORDS, (m) => `<span class="sql-keyword">${m}</span>`);
  html = html.replace(SQL_NUMBERS, (m) => `<span class="sql-number">${m}</span>`);
  return html;
}

function extractShortLabel(sql: string): string {
  const fromMatch = sql.match(/FROM\s+`?(\w+)`?/i);
  const action = sql.trim().split(/\s/)[0].toUpperCase();
  if (fromMatch) return `${action} ${fromMatch[1]}`;
  const firstLine = sql.trim().split('\n')[0];
  return firstLine.length > 30 ? firstLine.slice(0, 30) + '…' : firstLine;
}

export function SqlBlock({ sql }: { sql: string }) {
  const [copied, setCopied] = useState(false);
  const openTab = useEditorStore((s) => s.openTab);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const connections = useConnectionStore((s) => s.connections);
  const { runQuery } = useQueryExecution();

  const handleExecute = useCallback(() => {
    const current = tabs.find((t) => t.id === activeTabId);
    const connId = current?.connectionId || activeConnectionId || '';
    const activeConn = connections.find((c) => c.id === connId);
    const db = current?.database || activeConn?.database || '';
    const label = extractShortLabel(sql);
    const tab: EditorTab = {
      id: crypto.randomUUID(),
      title: label,
      sql,
      connectionId: connId,
      database: db,
      dirty: false,
    };
    openTab(tab);
    setTimeout(() => runQuery(sql), 0);
  }, [sql, activeTabId, tabs, openTab, runQuery, activeConnectionId, connections]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [sql]);

  return (
    <div className="sql-block">
      <pre
        className="sql-block-code"
        dangerouslySetInnerHTML={{ __html: highlightSql(sql) }}
      />
      <div className="sql-block-actions">
        <button className="sql-block-btn" onClick={handleExecute} title="Execute">
          <Play size={12} /> Execute
        </button>
        <button className="sql-block-btn" onClick={handleCopy} title="Copy">
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}
