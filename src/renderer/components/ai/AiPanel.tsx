import { useEffect, useRef } from 'react';
import { Bot, ChevronDown, Edit3, Sparkles, Table2, Trash2 } from 'lucide-react';
import type { TableSchema } from '../../../shared/types';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  meta?: string;
  warnings?: string[];
};

export function AiPanel({
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
  onClear
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
  onClear: () => void;
}) {
  const mentionListRef = useRef<HTMLDivElement>(null);

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
        <button className="ai-collapsed-btn" title="展开 AI 助手" onClick={onToggleCollapsed}>
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
          <p><Bot size={16} /> AI 助手</p>
          <strong>@table Schema Context</strong>
        </div>
        <button className="icon-btn" title="收起 AI 助手" onClick={onToggleCollapsed}><ChevronDown size={16} /></button>
      </div>

      <div className="schema-card">
        <div className="section-label">当前表结构</div>
        <h2>{selectedSchema?.name ?? '未选择表'}</h2>
        {selectedSchema && (
          <div className="table-meta">
            <span>{selectedSchema.type ?? 'table'}</span>
            {selectedSchema.engine && <span>{selectedSchema.engine}</span>}
            {selectedSchema.rowCount !== undefined && <span>~{selectedSchema.rowCount} rows</span>}
          </div>
        )}
        <div className="columns">
          {selectedSchema?.columns.map((column) => (
            <div className="column-row" key={column.name}>
              <span>{column.name}{column.primary ? ' · PK' : ''}{column.references ? ` · FK ${column.references}` : ''}</span>
              <em>{column.type}</em>
            </div>
          ))}
        </div>
        <div className="table-actions">
          <button onClick={onBrowseTable} disabled={!selectedSchema} title="浏览表数据"><Table2 size={13} /> 浏览</button>
          <button onClick={onDesignTable} disabled={!selectedSchema} title="打开表设计器"><Edit3 size={13} /> 设计</button>
          <button onClick={onSelectTemplate} disabled={!selectedSchema} title="生成 SELECT">SELECT</button>
          <button onClick={onCountTemplate} disabled={!selectedSchema} title="生成 COUNT">COUNT</button>
          <button onClick={onLoadDdl} disabled={!selectedSchema} title="读取 DDL">DDL</button>
        </div>
      </div>

      <div className="chat-list">
        {chat.map((message, index) => (
          <div className={`chat-message ${message.role}`} key={index}>
            {message.meta && <div className="meta">{message.meta}</div>}
            <p>{message.content}</p>
            {message.sql && <pre>{message.sql}</pre>}
            {message.warnings?.map((warning) => <div className="warning" key={warning}>{warning}</div>)}
          </div>
        ))}
        {aiLoading && (
          <div className="chat-message assistant loading-message">
            <div className="meta">AI 助手</div>
            <p><span className="spinner" /> 正在生成 SQL...</p>
          </div>
        )}
      </div>

      <div className="composer">
        <div className="composer-input-wrap">
          <textarea
            ref={textareaRef}
            value={aiInput}
            placeholder="使用 @ 引用表结构，描述查询需求..."
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
          <span>{mentionedTables.length ? `已引用 ${mentionedTables.join(', ')}` : '输入 @ 引用表'}</span>
          <button onClick={onGenerate} disabled={busy}><Sparkles size={15} /> {aiLoading ? '生成中' : '生成 SQL'}</button>
          <button className="text-danger" onClick={onClear} title="清空对话"><Trash2 size={14} /></button>
        </div>
      </div>
      </div>
    </aside>
  );
}
