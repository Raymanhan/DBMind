import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

function relativeTime(iso: string, t: (key: string, options?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('time.daysAgo', { count: days });
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
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const active = conversations.find((c) => c.id === activeId);
  const title = active?.title ?? t('ai.newConversationTitle');

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
      <button className="new-conv-btn" title={t('ai.newConversation')} onClick={onCreateNew}><Plus size={14} /></button>
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
            <span>{t('ai.conversationHistory')}</span>
            {conversations.length > 0 && (
              <button onClick={() => { onClearAll(); setOpen(false); }}>{t('ai.clearAll')}</button>
            )}
          </div>
          {conversations.length === 0 ? (
            <div className="conv-item" style={{ color: 'var(--dim)', cursor: 'default' }}>
              {t('ai.noConversations')}
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
                    {t('ai.messageCount', { count: conv.messages.filter((m) => m.role !== 'assistant' || m.content).length })} · {relativeTime(conv.updatedAt, t)}
                  </span>
                </div>
                <span
                  className="conv-delete-btn"
                  title={t('settings.delete')}
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
