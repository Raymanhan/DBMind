import { Plus, Trash2 } from 'lucide-react';
import type { Conversation } from '../../shared/stores/chatStore';

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  pinnedTables: Conversation['pinnedTables'];
  onUnpin: (database: string, table: string) => void;
}

export function AiConversationHeader({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  pinnedTables,
  onUnpin,
}: Props) {
  const active = conversations.find((c) => c.id === activeId);

  return (
    <div className="conv-header">
      <div className="conv-header-row">
        <select
          className="conv-selector"
          value={activeId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          {conversations.length === 0 && <option value="">No conversations</option>}
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button className="conv-btn" onClick={onNew} title="New chat">
          <Plus size={14} />
        </button>
        {active && conversations.length > 0 && (
          <button className="conv-btn" onClick={() => onDelete(active.id)} title="Delete chat">
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {pinnedTables.length > 0 && (
        <div className="pinned-tables">
          {pinnedTables.map((p) => (
            <span key={`${p.database}.${p.table}`} className="pinned-badge">
              {p.database}.{p.table}
              <button className="pinned-remove" onClick={() => onUnpin(p.database, p.table)}>
                <Trash2 size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
