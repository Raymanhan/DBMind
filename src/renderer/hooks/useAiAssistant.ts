import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiConversation, AiGenerateResponse, AiHistoryMessage, AiOptimizeResponse, AiProviderConfig, AiTableDdl, ChatMessage, DbmindApi, TableSchema } from '../../shared/types';
import { extractTableMentions } from '../../shared/sqlTools';
import { quoteMysqlIdentifier } from '../../shared/sql/identifiers';
import type { WorkTab } from '../../shared/types';

function makeWelcomeMessage(t: (key: string, options?: Record<string, unknown>) => string): ChatMessage {
  return {
    role: 'assistant',
    content: t('ai.welcome'),
    meta: t('ai.schemaAware')
  };
}

function makeConversation(id: string, t: (key: string, options?: Record<string, unknown>) => string): AiConversation {
  return {
    id,
    title: t('ai.newConversationTitle'),
    messages: [makeWelcomeMessage(t)],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function titleFromMessage(content: string): string {
  return content.length > 40 ? content.slice(0, 40).trimEnd() + '...' : content;
}

function buildConversationHistory(messages: ChatMessage[], maxRounds = 5): AiHistoryMessage[] {
  const history: AiHistoryMessage[] = [];
  // Skip the initial welcome message, start from index 1
  const relevant = messages.slice(1);
  // Take at most maxRounds pairs (2 messages per round)
  const recent = relevant.slice(-maxRounds * 2);
  for (const msg of recent) {
    if (msg.role === 'user') {
      history.push({ role: 'user', content: msg.content });
    } else {
      const parts: string[] = [];
      if (msg.sql) parts.push(`SQL: ${msg.sql}`);
      if (msg.content) parts.push(msg.content);
      history.push({ role: 'assistant', content: parts.join('\n') });
    }
  }
  return history;
}

function tableContextKey(table: TableSchema): string {
  return `${table.dbName ?? ''}.${table.name}`.toLowerCase();
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
  const { t, i18n } = useTranslation();
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
    return conv?.messages ?? [makeWelcomeMessage(t)];
  }, [conversations, activeConversationId, t]);

  const mentionedTables = useMemo(() => extractTableMentions(aiInput), [aiInput]);

  const mentionOptions = useMemo(() => {
    if (!mentionQuery) return [];
    const { db, table } = mentionQuery;
    const result: { db: string; table: TableSchema }[] = [];
    for (const [dbName, tables] of Object.entries(schemaMap)) {
      if (db && db.toLowerCase() !== dbName.toLowerCase()) continue;
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
        setConversations([makeConversation(id, t)]);
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

  useEffect(() => {
    if (!conversationsLoaded) return;
    setConversations((prev) => prev.map((conversation) => {
      const userMessages = conversation.messages.filter((message) => message.role === 'user');
      const isDefaultTitle = conversation.title === '新对话' || conversation.title === 'New conversation' || conversation.title === t('ai.newConversationTitle');
      if (userMessages.length > 0 && !isDefaultTitle) return conversation;
      const [first, ...rest] = conversation.messages;
      const shouldReplaceWelcome = !first || (first.role === 'assistant' && !first.sql && rest.length === 0);
      return {
        ...conversation,
        title: isDefaultTitle ? t('ai.newConversationTitle') : conversation.title,
        messages: shouldReplaceWelcome ? [makeWelcomeMessage(t)] : conversation.messages
      };
    }));
  }, [conversationsLoaded, i18n.language, t]);

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
    setConversations((prev) => [makeConversation(id, t), ...prev]);
    setActiveConversationId(id);
    setAiInput('');
  }, [t]);

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
        return [makeConversation(newId, t)];
      }
      if (id === activeConvIdRef.current) {
        setActiveConversationId(next[0]?.id ?? '');
      }
      return next;
    });
  }, [api, t]);

  const clearAllConversations = useCallback(() => {
    api.clearAiConversations();
    const id = crypto.randomUUID();
    setConversations([makeConversation(id, t)]);
    setActiveConversationId(id);
    setAiInput('');
  }, [api, t]);

  const generateSql = useCallback(async () => {
    setLoadingFlag('ai', true);
    const currentInput = aiInputRef.current;
    const currentConvId = activeConvIdRef.current;
    try {
      const names = extractTableMentions(currentInput);
      const tables: TableSchema[] = [];
      const seenTables = new Set<string>();
      const addTable = (table: TableSchema, dbName?: string) => {
        const item = { ...table, dbName: table.dbName ?? dbName };
        const key = tableContextKey(item);
        if (!seenTables.has(key)) {
          seenTables.add(key);
          tables.push(item);
        }
      };

      for (const name of names) {
        if (name.includes('.')) {
          const [db, tableName] = name.split('.');
          const dbKey = Object.keys(schemaMap).find((k) => k.toLowerCase() === db.toLowerCase());
          if (dbKey) {
            const found = schemaMap[dbKey].find((t) => t.name.toLowerCase() === tableName.toLowerCase());
            if (found) addTable(found, dbKey);
          }
        } else {
          let matched = false;
          for (const [dbName, dbTables] of Object.entries(schemaMap)) {
            const found = dbTables.find((t) => t.name.toLowerCase() === name.toLowerCase());
            if (found) {
              addTable(found, dbName);
              matched = true;
              break;
            }
          }
          if (!matched) {
            const found = allTables.find((t) => t.name.toLowerCase() === name.toLowerCase());
            if (found) addTable(found);
          }
        }
      }
      const context = tables.length
        ? tables
        : selectedSchema
          ? [{ ...selectedSchema, dbName: selectedSchema.dbName ?? selectedSchemaDb }]
          : [];
      const tableDdls: AiTableDdl[] = await Promise.all(context.map(async (table) => {
        const ddl = await api.getTableDdl(activeConnectionId, table.name, table.dbName);
        if (!ddl.trim()) throw new Error(t('ai.ddlMissing', { table: table.dbName ? `${table.dbName}.${table.name}` : table.name }));
        return { database: table.dbName, table: table.name, ddl };
      }));
      const currentConv = conversationsRef.current.find(c => c.id === activeConvIdRef.current);
      const history = buildConversationHistory(currentConv?.messages ?? [makeWelcomeMessage(t)]);
      const request = { prompt: currentInput, dialect: (activeConnection?.driver as 'mysql' | 'postgres') ?? 'mysql', tables: context, tableDdls, history, language: i18n.language };

      const userMsg: ChatMessage = { role: 'user', content: currentInput };

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== currentConvId) return c;
          const needsTitle = c.title === t('ai.newConversationTitle') && c.messages.filter((m) => m.role !== 'assistant' || m.content).length <= 1;
          return {
            ...c,
            title: needsTitle ? titleFromMessage(currentInput) : c.title,
            messages: [...c.messages, userMsg],
            updatedAt: new Date().toISOString()
          };
        })
      );

      const response: AiGenerateResponse = await api.generateSql(request);
      const assistantMsg: ChatMessage = {
        role: 'assistant', content: response.explanation, sql: response.sql, warnings: response.warnings,
        meta: t('ai.ddlInjected', { source: response.source === 'local' ? 'Local' : defaultProvider?.name ?? 'AI', tables: tableDdls.map((item) => item.database ? `${item.database}.${item.table}` : item.table).join(', ') || selectedTable })
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
          ? { ...c, messages: [...c.messages, { role: 'assistant', content: error instanceof Error ? error.message : t('ai.generateFailed'), meta: t('ai.error') }], updatedAt: new Date().toISOString() }
          : c)
      );
    } finally { setLoadingFlag('ai', false); }
  }, [schemaMap, allTables, selectedSchema, selectedSchemaDb, api, activeConnectionId, activeConnection, updateActiveWorkTab, defaultProvider, setLoadingFlag, selectedTable, t, i18n.language]);
  generateSqlRef.current = generateSql;

  const optimizeSql = useCallback(async (sql: string) => {
    if (!sql.trim()) { setNotice(t('notice.noOptimizableSql')); return; }
    setLoadingFlag('ai', true);
    const tables = selectedSchema ? [selectedSchema] : [];
    const dialect = (activeConnection?.driver as 'mysql' | 'postgres') ?? 'mysql';

    let currentConvId = activeConvIdRef.current;
    if (!conversationsRef.current.find(c => c.id === currentConvId)) {
      const id = crypto.randomUUID();
      setConversations(prev => [makeConversation(id, t), ...prev]);
      setActiveConversationId(id);
      currentConvId = id;
    }

    const userMsg: ChatMessage = { role: 'user', content: t('ai.optimizeRequest', { sql }) };

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== currentConvId) return c;
        const needsTitle = c.title === t('ai.newConversationTitle') && c.messages.filter((m) => m.role !== 'assistant' || m.content).length <= 1;
        return {
          ...c,
          title: needsTitle ? t('ai.optimizeTitle') : c.title,
          messages: [...c.messages, userMsg],
          updatedAt: new Date().toISOString()
        };
      })
    );

    try {
      const response: AiOptimizeResponse = await api.optimizeSql({ sql, dialect, tables, language: i18n.language });
      const assistantMsg: ChatMessage = {
        role: 'assistant', content: response.explanation, sql: response.sql, warnings: response.warnings,
        meta: t('ai.optimizedBy', { source: response.source === 'local' ? 'Local' : defaultProvider?.name ?? 'AI' })
      };
      setConversations((prev) =>
        prev.map((c) => c.id === currentConvId
          ? { ...c, messages: [...c.messages, assistantMsg], updatedAt: new Date().toISOString() }
          : c)
      );
      if (response.sql !== sql) {
        updateActiveWorkTab({ baseSql: response.sql, sql: response.sql, sort: undefined });
      }
    } catch (error) {
      setConversations((prev) =>
        prev.map((c) => c.id === currentConvId
          ? { ...c, messages: [...c.messages, { role: 'assistant', content: error instanceof Error ? error.message : t('ai.optimizeFailed'), meta: t('ai.error') }], updatedAt: new Date().toISOString() }
          : c)
      );
    } finally { setLoadingFlag('ai', false); }
  }, [selectedSchema, activeConnection, api, updateActiveWorkTab, defaultProvider, setLoadingFlag, setNotice, t, i18n.language]);

  const insertTableSelect = useCallback((limit = 100) => {
    if (!selectedSchema) { setNotice(t('table.noTableSelected')); return; }
    const visibleColumns = selectedSchema.columns.slice(0, 12).map((c) => `  ${quoteMysqlIdentifier(c.name)}`).join(',\n') || '  *';
    const baseSql = `SELECT\n${visibleColumns}\nFROM ${mysqlTableRef(selectedSchema.name, selectedSchemaDb)}`;
    updateActiveWorkTab({ baseSql, sql: `${baseSql}\nLIMIT ${limit};`, sort: undefined });
    setNotice(t('notice.templateGenerated', { table: selectedSchema.name }));
  }, [selectedSchema, selectedSchemaDb, updateActiveWorkTab, setNotice, mysqlTableRef, t]);

  const insertTableCount = useCallback(() => {
    if (!selectedSchema) { setNotice(t('table.noTableSelected')); return; }
    const nextSql = `SELECT COUNT(*) AS total_count\nFROM ${mysqlTableRef(selectedSchema.name, selectedSchemaDb)};`;
    updateActiveWorkTab({ baseSql: nextSql, sql: nextSql, sort: undefined });
    setNotice(t('notice.countGenerated', { table: selectedSchema.name }));
  }, [selectedSchema, selectedSchemaDb, updateActiveWorkTab, setNotice, mysqlTableRef, t]);

  const loadTableDdl = useCallback(async () => {
    if (!selectedSchema) { setNotice(t('table.noTableSelected')); return; }
    try {
      const ddl = await api.getTableDdl(activeConnectionId, selectedSchema.name, selectedSchemaDb);
      const nextSql = ddl || `-- ${t('ai.ddlMissing', { table: selectedSchema.name })}`;
      updateActiveWorkTab({ baseSql: nextSql, sql: nextSql, sort: undefined });
      setNotice(t('notice.ddlLoaded', { table: selectedSchema.name }));
    } catch (error) { setNotice(error instanceof Error ? error.message : t('notice.ddlFailed')); }
  }, [selectedSchema, api, activeConnectionId, updateActiveWorkTab, setNotice, selectedSchemaDb, t]);

  const browseSelectedTable = useCallback(() => {
    if (!selectedSchema) { setNotice(t('table.noTableSelected')); return; }
  }, [selectedSchema, setNotice, t]);

  return {
    aiInput, setAiInput,
    conversations, activeConversationId, activeMessages,
    createConversation, switchConversation, deleteConversation, clearAllConversations,
    textareaRef, mentionQuery, mentionIndex, mentionedTables, mentionOptions,
    handleAiChange, selectMention, handleAiKeyDown,
    generateSql, optimizeSql, insertTableSelect, insertTableCount, loadTableDdl, browseSelectedTable
  };
}
