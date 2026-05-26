import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, ChevronDown, Copy, Settings, Sparkles } from 'lucide-react';
import type { AiConversation, ChatMessage, TableSchema } from '../../../shared/types';
import { ConversationSwitcher } from './ConversationSwitcher';

export const AiPanel = memo(function AiPanel({
  selectedSchema,
  chat,
  aiInput,
  mentionedTables,
  busy,
  aiLoading,
  textareaRef,
  mentionQuery,
  mentionOptions,
  mentionIndex,
  conversations,
  activeConversationId,
  aiPanelWidth,
  collapsed,
  onToggleCollapsed,
  onStartResize,
  onInput,
  onKeyDown,
  onSelectMention,
  onGenerate,
  onSelectTemplate,
  onCountTemplate,
  onLoadDdl,
  onBrowseTable,
  onDesignTable,
  onCreateConversation,
  onSwitchConversation,
  onDeleteConversation,
  onClearAllConversations,
  onNavigateToSettings
}: {
  selectedSchema?: TableSchema;
  chat: ChatMessage[];
  aiInput: string;
  mentionedTables: string[];
  busy: boolean;
  aiLoading: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  mentionQuery: { db: string; table: string; start: number } | null;
  mentionOptions: { db: string; table: TableSchema }[];
  mentionIndex: number;
  conversations: AiConversation[];
  activeConversationId: string;
  aiPanelWidth: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onStartResize: (target: 'sidebar' | 'ai-panel', initialSize: number, e: React.MouseEvent) => void;
  onInput: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onSelectMention: (db: string, table: string) => void;
  onGenerate: () => void;
  onSelectTemplate: () => void;
  onCountTemplate: () => void;
  onLoadDdl: () => void;
  onBrowseTable: () => void;
  onDesignTable: () => void;
  onCreateConversation: () => void;
  onSwitchConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onClearAllConversations: () => void;
  onNavigateToSettings: () => void;
}) {
  const { t } = useTranslation();
  const mentionListRef = useRef<HTMLDivElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copySql = useCallback(async (index: number, sql: string) => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch { /* clipboard unavailable */ }
  }, []);

  useEffect(() => {
    if (!mentionQuery || mentionOptions.length === 0) return;
    const container = mentionListRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('.mention-item.active');
    active?.scrollIntoView({ block: 'nearest' });
  }, [mentionIndex, mentionQuery, mentionOptions.length]);

  if (collapsed) {
    return (
      <aside className="ai-panel collapsed">
        <button className="ai-collapsed-btn" title={t('ai.expand')} onClick={onToggleCollapsed}>
          <Sparkles size={18} />
          <span>AI</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="ai-panel">
      <div className="resize-handle-col" onMouseDown={(e) => onStartResize('ai-panel', aiPanelWidth, e)} />
      <div className="ai-panel-body">
      <div className="ai-head">
        <div>
          <p><Bot size={16} /> {t('ai.title')}</p>
          <ConversationSwitcher
            conversations={conversations}
            activeId={activeConversationId}
            onCreateNew={onCreateConversation}
            onSwitch={onSwitchConversation}
            onDelete={onDeleteConversation}
            onClearAll={onClearAllConversations}
          />
        </div>
        <button className="icon-btn" title={t('ai.collapse')} onClick={onToggleCollapsed}><ChevronDown size={16} /></button>
      </div>

      <div className="chat-list">
        {chat.map((message, index) => (
          <div className={`chat-message ${message.role}`} key={index}>
            {message.meta && <div className="meta">{message.meta}</div>}
            <p>{message.content}</p>
            {message.sql && (
              <div className="sql-block">
                <div className="sql-block-header">
                  <span>SQL</span>
                  <button className="sql-copy-btn" onClick={() => copySql(index, message.sql!)}>
                    {copiedIndex === index ? <><Check size={12} /> {t('result.cellCopied')}</> : <><Copy size={12} /> {t('ai.copySql')}</>}
                  </button>
                </div>
                <pre>{message.sql}</pre>
              </div>
            )}
            {message.warnings?.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
          </div>
        ))}
        {aiLoading && (
          <div className="chat-message assistant loading-message">
            <div className="meta">{t('ai.title')}</div>
            <p><span className="spinner" /> {t('ai.generating')}</p>
          </div>
        )}
      </div>

      <div className="composer">
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            value={aiInput}
            placeholder={t('ai.placeholder')}
            onChange={(event) => onInput(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {mentionQuery && mentionOptions.length > 0 && (
            <div className="mention-dropdown" ref={mentionListRef}>
              {mentionOptions.map((opt, idx) => (
                <button
                  key={`${opt.db}.${opt.table.name}`}
                  className={`mention-item ${idx === mentionIndex ? 'active' : ''}`}
                  onClick={() => onSelectMention(opt.db, opt.table.name)}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <span className="mention-db">{opt.db}</span>
                  <span className="mention-table">{opt.table.name}</span>
                  <em>{opt.table.columns.length}</em>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="composer-footer">
          <span>{mentionedTables.length ? t('ai.referencedTables', { tables: mentionedTables.join(', ') }) : t('ai.inputMention')}</span>
          <button className="ai-settings-btn" onClick={onNavigateToSettings} title={t('ai.settings')}><Settings size={14} /></button>
          <button className="ai-generate-btn" onClick={onGenerate} disabled={busy || !aiInput.trim()}><Sparkles size={15} /> {aiLoading ? t('ai.generating') : t('ai.generate')}</button>
        </div>
      </div>
      </div>
    </aside>
  );
});
