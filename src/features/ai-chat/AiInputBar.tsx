import { useState, useCallback, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { useEditorStore } from '../../shared/stores/editorStore';
import { useSettingsStore } from '../../shared/stores/settingsStore';
import { useChatStore } from '../../shared/stores/chatStore';
import { aiChat, generateDdl, extractTables, searchAllTables } from '../../shared/api/tauri';
import { extractTableMentions } from '../../shared/sqlTools';
import { AiTableMention } from './AiTableMention';
import type { CrossDbTableBrief } from '../../shared/api/types';

interface Props {
  conversationId: string;
  database: string;
  driver?: string;
  onStreamStart: () => void;
  onStreamEnd: () => void;
}

interface MentionState {
  active: boolean;
  startIndex: number;
  query: string;
  tables: CrossDbTableBrief[];
  activeIndex: number;
}

const INITIAL_MENTION: MentionState = {
  active: false,
  startIndex: -1,
  query: '',
  tables: [],
  activeIndex: 0,
};

export function AiInputBar({ conversationId, database, driver, onStreamStart, onStreamEnd }: Props) {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<MentionState>(INITIAL_MENTION);

  const activeConn = useSettingsStore((s) => s.activeConnection());
  const addMessage = useChatStore((s) => s.addMessage);
  const pinTable = useChatStore((s) => s.pinTable);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTab = useEditorStore((s) => s.tabs.find((t) => t.id === activeTabId));

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const convIdRef = useRef(conversationId);
  convIdRef.current = conversationId;

  // Refs to keep handleSend stable while still reading latest state
  const inputRef = useRef(input);
  inputRef.current = input;
  const sendingRef = useRef(sending);
  sendingRef.current = sending;

  useEffect(() => {
    if (!database) return;
    let cancelled = false;
    searchAllTables('')
      .then((tables) => {
        if (!cancelled) {
          setMention((prev) => ({ ...prev, tables }));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [database]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  // ─── Process @ mentions: extract and pin tables ───────
  const processMentions = useCallback(
    async (text: string) => {
      const currentConvId = convIdRef.current;
      const mentions = extractTableMentions(text);
      for (const m of mentions) {
        try {
          const ddl = await generateDdl(m.database, m.table);
          pinTable(currentConvId, { database: m.database, table: m.table, ddl });
        } catch {
          // Table not found, skip
        }
      }
    },
    [pinTable],
  );

  // ─── Paste handler ────────────────────────────────────
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const pastedText = e.clipboardData.getData('text/plain');
      // If pasted content contains @db.table references, process them immediately
      if (/@[\w-]+\.[\w]+/.test(pastedText)) {
        processMentions(pastedText);
      }
    },
    [processMentions],
  );

  // ─── Mention trigger ──────────────────────────────────
  const detectMention = useCallback(
    (text: string, cursorPos: number) => {
      let atIdx = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === '@') {
          if (i === 0 || /\s/.test(text[i - 1])) {
            atIdx = i;
          }
          break;
        }
        if (/\s/.test(ch)) break;
      }

      if (atIdx === -1) {
        setMention((prev) => (prev.active ? INITIAL_MENTION : prev));
        return;
      }

      const query = text.slice(atIdx + 1, cursorPos);

      setMention((prev) => ({
        ...prev,
        active: true,
        startIndex: atIdx,
        query,
        activeIndex: 0,
      }));

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        searchAllTables(query)
          .then((tables) => {
            setMention((prev) => {
              if (!prev.active) return prev;
              return { ...prev, tables };
            });
          })
          .catch(() => {});
      }, 150);
    },
    [],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const text = e.target.value;
      setInput(text);
      detectMention(text, e.target.selectionStart);
      requestAnimationFrame(autoResize);
    },
    [detectMention, autoResize],
  );

  // ─── Mention selection ────────────────────────────────
  const handleMentionSelect = useCallback(
    (table: CrossDbTableBrief) => {
      if (!textareaRef.current) return;
      const currentInput = inputRef.current;
      const cursorPos = textareaRef.current.selectionStart;
      const before = currentInput.slice(0, mention.startIndex);
      const after = currentInput.slice(cursorPos);
      const insertText = `@${table.database}.${table.name} `;
      const newText = `${before}${insertText}${after}`;
      setInput(newText);
      setMention(INITIAL_MENTION);

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          const newPos = before.length + insertText.length;
          textareaRef.current.selectionStart = newPos;
          textareaRef.current.selectionEnd = newPos;
          textareaRef.current.focus();
          autoResize();
        }
      });
    },
    [mention.startIndex, autoResize],
  );

  // ─── Keyboard ─────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // When mention dropdown is active
      if (mention.active && mention.tables.length > 0) {
        const filtered = getFilteredTables(mention.tables, mention.query);
        if (filtered.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const count = Math.min(filtered.length, 50);
            setMention((prev) => ({
              ...prev,
              activeIndex: (prev.activeIndex + 1) % count,
            }));
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            const count = Math.min(filtered.length, 50);
            setMention((prev) => ({
              ...prev,
              activeIndex: (prev.activeIndex - 1 + count) % count,
            }));
            return;
          }
          if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            handleMentionSelect(filtered[mention.activeIndex]);
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setMention(INITIAL_MENTION);
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [mention, handleMentionSelect],
  );

  // ─── Send ─────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputRef.current.trim();
    if (!text || sendingRef.current) return;

    const currentConvId = convIdRef.current;

    setInput('');
    setSending(true);
    setMention(INITIAL_MENTION);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMsg = { id: crypto.randomUUID(), role: 'user' as const, content: text };
    addMessage(currentConvId, userMsg);

    try {
      const mentions = extractTableMentions(text);
      const ddlList: string[] = [];
      for (const m of mentions) {
        try {
          const ddl = await generateDdl(m.database, m.table);
          ddlList.push(ddl);
          pinTable(currentConvId, { database: m.database, table: m.table, ddl });
        } catch {
          // Table not found, skip
        }
      }

      const freshConv = useChatStore.getState().conversations.find((c) => c.id === currentConvId);
      const pinnedDdls = (freshConv?.pinnedTables ?? []).map((p) => p.ddl);
      const allDdls = [...new Set([...pinnedDdls, ...ddlList])];

      const currentSql = useEditorStore.getState().tabs.find(
        (t) => t.id === useEditorStore.getState().activeTabId,
      )?.sql;

      if (currentSql?.trim()) {
        try {
          const tables = await extractTables(currentSql);
          for (const t of tables) {
            if (!allDdls.some((d) => d.includes(`\`${t}\``))) {
              try {
                const ddl = await generateDdl(database, t);
                allDdls.push(ddl);
              } catch { /* skip */ }
            }
          }
        } catch { /* skip */ }
      }

      const convForHistory = useChatStore.getState().conversations.find((c) => c.id === currentConvId);
      const history = (convForHistory?.messages ?? [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role, content: m.content }));

      onStreamStart();
      await aiChat(
        database, history, currentSql, allDdls,
        activeConn?.api_key, activeConn?.model, activeConn?.api_url, activeConn?.max_tokens, activeConn?.temperature,
        driver,
      );
      onStreamEnd();
    } catch (err) {
      addMessage(currentConvId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${err}`,
      });
      onStreamEnd();
    } finally {
      setSending(false);
    }
  }, [database, driver, activeConn, addMessage, pinTable, onStreamStart, onStreamEnd]);

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setMention((prev) => ({ ...prev, active: false }));
    }, 150);
  }, []);

  return (
    <div className="ai-input-bar">
      <div className="ai-input-wrapper">
        {mention.active && (
          <AiTableMention
            tables={mention.tables}
            query={mention.query}
            activeIndex={mention.activeIndex}
            onSelect={handleMentionSelect}
          />
        )}
        <div className="ai-input-composer">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onBlur={handleBlur}
            placeholder={activeConn?.api_key ? 'Ask AI… (type @ to add table context)' : 'Set API key in Settings first'}
            disabled={sending}
            rows={1}
          />
          <button className="ai-send-btn" onClick={handleSend} disabled={sending || !input.trim()}>
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function getFilteredTables(tables: CrossDbTableBrief[], query: string): CrossDbTableBrief[] {
  if (!query) return tables.slice(0, 50);
  const lower = query.toLowerCase();
  return tables.filter(
    (t) =>
      t.name.toLowerCase().includes(lower) ||
      t.database.toLowerCase().includes(lower) ||
      (t.comment?.toLowerCase().includes(lower) ?? false),
  ).slice(0, 50);
}
