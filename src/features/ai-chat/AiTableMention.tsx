import { useMemo, useRef, useEffect } from 'react';
import { Table2, Database } from 'lucide-react';
import type { CrossDbTableBrief } from '../../shared/api/types';
import { fuzzyMatch, fuzzyHighlight } from '../../shared/utils/fuzzy';

interface Props {
  tables: CrossDbTableBrief[];
  query: string;
  activeIndex: number;
  onSelect: (table: CrossDbTableBrief) => void;
}

interface ScoredTable {
  table: CrossDbTableBrief;
  nameIndices: number[];
  score: number;
}

interface GroupedTable {
  database: string;
  tables: ScoredTable[];
}

export function AiTableMention({ tables, query, activeIndex, onSelect }: Props) {
  const activeRef = useRef<HTMLDivElement>(null);

  const { flattened, groups } = useMemo(() => {
    let scored: ScoredTable[];

    if (!query) {
      scored = tables.map((t) => ({ table: t, nameIndices: [], score: 0 }));
    } else {
      const matches: ScoredTable[] = [];
      for (const t of tables) {
        // Match against table name (primary), database name, or comment
        const nameResult = fuzzyMatch(t.name, query);
        const dbResult = fuzzyMatch(t.database, query);
        const commentResult = t.comment ? fuzzyMatch(t.comment, query) : null;

        const best = [nameResult, dbResult, commentResult]
          .filter(Boolean)
          .sort((a, b) => b!.score - a!.score)[0];

        if (best) {
          matches.push({
            table: t,
            nameIndices: nameResult?.indices ?? [],
            score: best.score + (nameResult ? 10 : 0), // prefer name matches
          });
        }
      }

      // Sort by score descending
      matches.sort((a, b) => b.score - a.score);
      scored = matches;
    }

    const dbMap = new Map<string, ScoredTable[]>();
    for (const s of scored) {
      const list = dbMap.get(s.table.database) ?? [];
      list.push(s);
      dbMap.set(s.table.database, list);
    }

    const groups: GroupedTable[] = [...dbMap.entries()].map(([database, items]) => ({
      database,
      tables: items,
    }));

    const flattened: CrossDbTableBrief[] = [];
    for (const g of groups) {
      flattened.push(...g.tables.map((s) => s.table));
    }

    return { flattened, groups };
  }, [tables, query]);

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

  // Build a map from table key → nameIndices for highlight rendering
  const indexMap = new Map<string, number[]>();
  for (const g of groups) {
    for (const s of g.tables) {
      indexMap.set(`${s.table.database}.${s.table.name}`, s.nameIndices);
    }
  }

  let runningIdx = 0;

  return (
    <div className="mention-dropdown">
      {groups.map((group) => (
        <div key={group.database}>
          <div className="mention-group-header">
            <Database size={11} />
            <span>{group.database}</span>
            <span className="mention-group-count">{group.tables.length}</span>
          </div>
          {group.tables.map((s) => {
            const idx = runningIdx++;
            const isActive = idx === activeIndex;
            const t = s.table;
            const indices = indexMap.get(`${t.database}.${t.name}`) ?? [];
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
                  dangerouslySetInnerHTML={{ __html: fuzzyHighlight(t.name, indices) }}
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
