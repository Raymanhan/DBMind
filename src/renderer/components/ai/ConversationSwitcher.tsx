import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';

import type { AiConversation } from '../../../shared/types';

interface ConversationSwitcherProps {
  conversations: AiConversation[];
  activeId: string;
  onCreateNew: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(iso).toLocaleDateString();
}

export function ConversationSwitcher({
  conversations,
  activeId,
  onCreateNew,
  onSwitch,
  onDelete,
  onClearAll
}: ConversationSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId);
  const title = active?.title ?? '新对话';

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', keyHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open]);

  return (
    <div className="conversation-switcher" ref={ref}>
      <button className="new-conv-btn" title="新建对话" onClick={onCreateNew}><Plus size={14} /></button>
      <button
        className="conv-title-btn"
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="conv-title">{title}</span>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div className="conv-dropdown">
          <div className="conv-dropdown-header">
            <span>历史会话</span>
            {conversations.length > 0 && (
              <button onClick={() => { onClearAll(); setOpen(false); }}>清空全部</button>
            )}
          </div>
          {conversations.length === 0 ? (
            <div className="conv-item" style={{ color: 'var(--dim)', cursor: 'default' }}>
              暂无历史会话
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.id}
                className={`conv-item${conv.id === activeId ? ' active' : ''}`}
                onClick={() => { onSwitch(conv.id); setOpen(false); }}
              >
                <div className="conv-item-main">
                  <strong>{conv.title}</strong>
                  <span className="conv-item-meta">
                    {conv.messages.filter((m) => m.role !== 'assistant' || m.content).length} 条消息 · {relativeTime(conv.updatedAt)}
                  </span>
                </div>
                <span
                  className="conv-delete-btn"
                  title="删除"
                  onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                  role="button"
                  tabIndex={0}
                >
                  <Trash2 size={13} />
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
