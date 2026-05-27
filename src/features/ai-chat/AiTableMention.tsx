import { useMemo, useRef, useEffect } from 'react';
import { Table2, Database } from 'lucide-react';
import type { CrossDbTableBrief } from '../../shared/api/types';

interface Props {
  tables: CrossDbTableBrief[];
  query: string;
  activeIndex: number;
  onSelect: (table: CrossDbTableBrief) => void;
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    text.slice(0, idx) +
    '<mark>' +
    text.slice(idx, idx + query.length) +
    '</mark>' +
    text.slice(idx + query.length)
  );
}

interface GroupedTable {
  database: string;
  tables: CrossDbTableBrief[];
}

export function AiTableMention({ tables, query, activeIndex, onSelect }: Props) {
  const activeRef = useRef<HTMLDivElement>(null);

  const { flattened, groups } = useMemo(() => {
    const filtered = query
      ? tables.filter(
          (t) =>
            t.name.toLowerCase().includes(query.toLowerCase()) ||
            t.database.toLowerCase().includes(query.toLowerCase()) ||
            (t.comment?.toLowerCase().includes(query.toLowerCase()) ?? false),
        )
      : tables;

    const dbMap = new Map<string, CrossDbTableBrief[]>();
    for (const t of filtered) {
      const list = dbMap.get(t.database) ?? [];
      list.push(t);
      dbMap.set(t.database, list);
    }

    const groups: GroupedTable[] = [...dbMap.entries()].map(([database, tbls]) => ({
      database,
      tables: tbls,
    }));

    const flattened: CrossDbTableBrief[] = [];
    for (const g of groups) {
      flattened.push(...g.tables);
    }

    return { flattened, groups };
  }, [tables, query]);

  // Scroll active item into view on keyboard navigation
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (flattened.length === 0) {
    return (
      <div className="mention-dropdown">
        <div className="mention-empty">No tables found</div>
      </div>
    );
  }

  let runningIdx = 0;

  return (
    <div className="mention-dropdown">
      {groups.map((group, gi) => (
        <div key={group.database}>
          <div className="mention-group-header">
            <Database size={11} />
            <span>{group.database}</span>
            <span className="mention-group-count">{group.tables.length}</span>
          </div>
          {group.tables.map((t) => {
            const idx = runningIdx++;
            const isActive = idx === activeIndex;
            return (
              <div
                key={`${t.database}.${t.name}`}
                ref={isActive ? activeRef : undefined}
                className={`mention-item${isActive ? ' active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(t);
                }}
              >
                <Table2 size={13} className="mention-item-icon" />
                <span className="mention-item-db">{t.database}</span>
                <span className="mention-item-dot">.</span>
                <span
                  className="mention-item-name"
                  dangerouslySetInnerHTML={{ __html: highlightMatch(t.name, query) }}
                />
                {t.comment && <span className="mention-item-comment">{t.comment}</span>}
                <span className="mention-item-cols">{t.columns.length} cols</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
