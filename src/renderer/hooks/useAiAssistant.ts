import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { AiConversation, AiGenerateResponse, AiProviderConfig, ChatMessage, DbmindApi, TableSchema } from '../../shared/types';
import { extractTableMentions } from '../../shared/sqlTools';
import { quoteMysqlIdentifier } from '../../shared/sql/identifiers';
import type { WorkTab } from '../../shared/types';

const welcomeMessage: ChatMessage = {
  role: 'assistant',
  content: '选择表后在输入框使用 @table 描述查询需求，我会把 SQL 生成到控制台。',
  meta: 'AI 助手 · Schema-aware'
};

function makeConversation(id: string): AiConversation {
  return {
    id,
    title: '新对话',
    messages: [welcomeMessage],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function titleFromMessage(content: string): string {
  return content.length > 40 ? content.slice(0, 40).trimEnd() + '...' : content;
}

export function useAiAssistant({
  api, allTables, schemaMap, selectedSchema, selectedSchemaDb, selectedTable,
  activeConnection, activeConnectionId, defaultProvider,
  setLoadingFlag, setNotice, updateActiveWorkTab,
  mysqlTableRef
}: {
  api: DbmindApi;
  allTables: TableSchema[];
  schemaMap: Record<string, TableSchema[]>;
  selectedSchema?: TableSchema;
  selectedSchemaDb?: string;
  selectedTable: string;
  activeConnection?: { driver: string };
  activeConnectionId: string;
  defaultProvider?: AiProviderConfig;
  setLoadingFlag: (k: 'ai', v: boolean) => void;
  setNotice: (msg: string) => void;
  updateActiveWorkTab: (patch: Partial<WorkTab>) => void;
  mysqlTableRef: (table: string, db?: string) => string;
}) {
  const [aiInput, setAiInput] = useState('');
  const aiInputRef = useRef(aiInput);
  aiInputRef.current = aiInput;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<{ db: string; table: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionOptionsRef = useRef<{ db: string; table: TableSchema }[]>([]);
  const mentionIndexRef = useRef(0);

  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;
  const activeConvIdRef = useRef(activeConversationId);
  activeConvIdRef.current = activeConversationId;
  const generateSqlRef = useRef<(() => void) | undefined>(undefined);

  const activeMessages = useMemo(() => {
    const conv = conversations.find((c) => c.id === activeConversationId);
    return conv?.messages ?? [welcomeMessage];
  }, [conversations, activeConversationId]);

  const mentionedTables = useMemo(() => extractTableMentions(aiInput), [aiInput]);

  const mentionOptions = useMemo(() => {
    if (!mentionQuery) return [];
    const { db, table } = mentionQuery;
    const result: { db: string; table: TableSchema }[] = [];
    for (const [dbName, tables] of Object.entries(schemaMap)) {
      if (db && db !== dbName) continue;
      for (const t of tables) {
        if (!table || t.name.toLowerCase().includes(table.toLowerCase())) {
          result.push({ db: dbName, table: t });
        }
      }
    }
    return result;
  }, [mentionQuery, schemaMap]);
  mentionOptionsRef.current = mentionOptions;
  mentionIndexRef.current = mentionIndex;

  useEffect(() => {
    api.listAiConversations().then((saved) => {
      if (saved.length > 0) {
        setConversations(saved);
        setActiveConversationId(saved[0].id);
      } else {
        const id = crypto.randomUUID();
        setConversations([makeConversation(id)]);
        setActiveConversationId(id);
      }
      setConversationsLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!conversationsLoaded) return;
    const conv = conversations.find((c) => c.id === activeConversationId);
    if (!conv || conv.messages.length <= 1) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const latest = conversationsRef.current.find((c) => c.id === activeConvIdRef.current);
      if (latest) {
        api.saveAiConversation({ ...latest, updatedAt: new Date().toISOString() });
      }
    }, 500);
    return () => clearTimeout(saveTimerRef.current);
  }, [activeMessages, conversationsLoaded, activeConversationId, api]);

  const handleAiChange = useCallback((value: string) => {
    setAiInput(value);
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const before = value.slice(0, cursor);
    const match = before.match(/@([\w.-]*)$/);
    if (match) {
      const parts = match[1].split('.');
      setMentionQuery({ db: parts.length > 1 ? parts[0] : '', table: parts.length > 1 ? parts[1] : parts[0], start: match.index! });
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }, []);

  const selectMention = useCallback((db: string, tableName: string) => {
    if (!mentionQuery) return;
    const input = aiInputRef.current;
    const before = input.slice(0, mentionQuery.start);
    const typedLen = 1 + (mentionQuery.db ? mentionQuery.db.length + 1 + mentionQuery.table.length : mentionQuery.table.length);
    const after = input.slice(mentionQuery.start + typedLen);
    setAiInput(before + `@${db}.${tableName} ` + after);
    setMentionQuery(null);
    textareaRef.current?.focus();
  }, [mentionQuery]);

  const handleAiKeyDown = useCallback((event: React.KeyboardEvent) => {
    // Mention dropdown navigation
    if (mentionQuery) {
      const opts = mentionOptionsRef.current;
      const idx = mentionIndexRef.current;
      if (opts.length > 0) {
        if (event.key === 'Escape') { setMentionQuery(null); event.preventDefault(); return; }
        if (event.key === 'ArrowDown') { setMentionIndex((prev) => Math.min(prev + 1, opts.length - 1)); event.preventDefault(); return; }
        if (event.key === 'ArrowUp') { setMentionIndex((prev) => Math.max(prev - 1, 0)); event.preventDefault(); return; }
        if (event.key === 'Enter') {
          const selected = opts[idx];
          if (selected) { selectMention(selected.db, selected.table.name); event.preventDefault(); }
          return;
        }
      }
    }
    // Enter sends, Shift+Enter for newline
    if (event.key === 'Enter' && !event.shiftKey && aiInput.trim()) {
      event.preventDefault();
      generateSqlRef.current?.();
    }
  }, [mentionQuery, selectMention, aiInput]);

  const createConversation = useCallback(() => {
    const id = crypto.randomUUID();
    setConversations((prev) => [makeConversation(id), ...prev]);
    setActiveConversationId(id);
    setAiInput('');
  }, []);

  const switchConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const deleteConversation = useCallback((id: string) => {
    api.deleteAiConversation(id);
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const newId = crypto.randomUUID();
        setActiveConversationId(newId);
        return [makeConversation(newId)];
      }
      if (id === activeConvIdRef.current) {
        setActiveConversationId(next[0]?.id ?? '');
      }
      return next;
    });
  }, [api]);

  const clearAllConversations = useCallback(() => {
    api.clearAiConversations();
    const id = crypto.randomUUID();
    setConversations([makeConversation(id)]);
    setActiveConversationId(id);
    setAiInput('');
  }, [api]);

  const generateSql = useCallback(async () => {
    setLoadingFlag('ai', true);
    const currentInput = aiInputRef.current;
    const names = extractTableMentions(currentInput);
    const tables: TableSchema[] = [];
    for (const name of names) {
      if (name.includes('.')) {
        const [db, tableName] = name.split('.');
        const dbTables = schemaMap[db];
        if (dbTables) { const found = dbTables.find((t) => t.name === tableName); if (found) tables.push({ ...found, dbName: db }); }
      } else {
        const found = allTables.find((t) => t.name === name);
        if (found) tables.push(found);
      }
    }
    const context = tables.length ? tables : selectedSchema ? [selectedSchema] : [];
    const request = { prompt: currentInput, dialect: (activeConnection?.driver as 'mysql' | 'postgres') ?? 'mysql', tables: context };

    const currentConvId = activeConvIdRef.current;
    const userMsg: ChatMessage = { role: 'user', content: currentInput };

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== currentConvId) return c;
        const needsTitle = c.title === '新对话' && c.messages.filter((m) => m.role !== 'assistant' || m.content).length <= 1;
        return {
          ...c,
          title: needsTitle ? titleFromMessage(currentInput) : c.title,
          messages: [...c.messages, userMsg],
          updatedAt: new Date().toISOString()
        };
      })
    );

    try {
      const response: AiGenerateResponse = await api.generateSql(request);
      const assistantMsg: ChatMessage = {
        role: 'assistant', content: response.explanation, sql: response.sql, warnings: response.warnings,
        meta: `${response.source === 'local' ? 'Local' : defaultProvider?.name ?? 'AI'} · 已注入 ${response.usedTables.join(', ') || selectedTable}`
      };
      setConversations((prev) =>
        prev.map((c) => c.id === currentConvId
          ? { ...c, messages: [...c.messages, assistantMsg], updatedAt: new Date().toISOString() }
          : c)
      );
      updateActiveWorkTab({ baseSql: response.sql, sql: response.sql, sort: undefined });
      setAiInput('');
    } catch (error) {
      setConversations((prev) =>
        prev.map((c) => c.id === currentConvId
          ? { ...c, messages: [...c.messages, { role: 'assistant', content: error instanceof Error ? error.message : 'AI 生成失败', meta: 'AI 错误' }], updatedAt: new Date().toISOString() }
          : c)
      );
    } finally { setLoadingFlag('ai', false); }
  }, [schemaMap, allTables, selectedSchema, api, activeConnection, updateActiveWorkTab, defaultProvider, setLoadingFlag, selectedTable]);
  generateSqlRef.current = generateSql;

  const insertTableSelect = useCallback((limit = 100) => {
    if (!selectedSchema) { setNotice('请先选择一张表。'); return; }
    const visibleColumns = selectedSchema.columns.slice(0, 12).map((c) => `  ${quoteMysqlIdentifier(c.name)}`).join(',\n') || '  *';
    const baseSql = `SELECT\n${visibleColumns}\nFROM ${mysqlTableRef(selectedSchema.name, selectedSchemaDb)}`;
    updateActiveWorkTab({ baseSql, sql: `${baseSql}\nLIMIT ${limit};`, sort: undefined });
    setNotice(`已生成 ${selectedSchema.name} 的 SELECT 模板`);
  }, [selectedSchema, selectedSchemaDb, updateActiveWorkTab, setNotice, mysqlTableRef]);

  const insertTableCount = useCallback(() => {
    if (!selectedSchema) { setNotice('请先选择一张表。'); return; }
    const nextSql = `SELECT COUNT(*) AS total_count\nFROM ${mysqlTableRef(selectedSchema.name, selectedSchemaDb)};`;
    updateActiveWorkTab({ baseSql: nextSql, sql: nextSql, sort: undefined });
    setNotice(`已生成 ${selectedSchema.name} 的 COUNT 模板`);
  }, [selectedSchema, selectedSchemaDb, updateActiveWorkTab, setNotice, mysqlTableRef]);

  const loadTableDdl = useCallback(async () => {
    if (!selectedSchema) { setNotice('请先选择一张表。'); return; }
    try {
      const ddl = await api.getTableDdl(activeConnectionId, selectedSchema.name, selectedSchemaDb);
      const nextSql = ddl || `-- 未读取到 ${selectedSchema.name} 的 DDL`;
      updateActiveWorkTab({ baseSql: nextSql, sql: nextSql, sort: undefined });
      setNotice(`已读取 ${selectedSchema.name} 的建表 DDL`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'DDL 读取失败'); }
  }, [selectedSchema, api, activeConnectionId, updateActiveWorkTab, setNotice]);

  const browseSelectedTable = useCallback(() => {
    if (!selectedSchema) { setNotice('请先选择一张表。'); return; }
  }, [selectedSchema, setNotice]);

  return {
    aiInput, setAiInput,
    conversations, activeConversationId, activeMessages,
    createConversation, switchConversation, deleteConversation, clearAllConversations,
    textareaRef, mentionQuery, mentionIndex, mentionedTables, mentionOptions,
    handleAiChange, selectMention, handleAiKeyDown,
    generateSql, insertTableSelect, insertTableCount, loadTableDdl, browseSelectedTable
  };
}
