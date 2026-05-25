import { useState, useMemo, useCallback, useRef } from 'react';
import type { AiGenerateResponse, AiProviderConfig, DbmindApi, TableSchema } from '../../shared/types';
import { extractTableMentions } from '../../shared/sqlTools';
import { quoteMysqlIdentifier } from '../../shared/sql/identifiers';
import type { WorkTab } from '../../shared/types';

type ChatMessage = { role: 'user' | 'assistant'; content: string; sql?: string; meta?: string; warnings?: string[] };

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
  const [chat, setChat] = useState<ChatMessage[]>([
    { role: 'assistant', content: '选择表后在输入框使用 @table 描述查询需求，我会把 SQL 生成到控制台。', meta: 'AI 助手 · Schema-aware' }
  ]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<{ db: string; table: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

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
    const before = aiInput.slice(0, mentionQuery.start);
    const typedLen = 1 + (mentionQuery.db ? mentionQuery.db.length + 1 + mentionQuery.table.length : mentionQuery.table.length);
    const after = aiInput.slice(mentionQuery.start + typedLen);
    setAiInput(before + `@${db}.${tableName} ` + after);
    setMentionQuery(null);
    textareaRef.current?.focus();
  }, [mentionQuery, aiInput]);

  const handleAiKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!mentionQuery || mentionOptions.length === 0) return;
    if (event.key === 'Escape') { setMentionQuery(null); event.preventDefault(); return; }
    if (event.key === 'ArrowDown') { setMentionIndex((prev) => Math.min(prev + 1, mentionOptions.length - 1)); event.preventDefault(); return; }
    if (event.key === 'ArrowUp') { setMentionIndex((prev) => Math.max(prev - 1, 0)); event.preventDefault(); return; }
    if (event.key === 'Enter') {
      const selected = mentionOptions[mentionIndex];
      if (selected) { selectMention(selected.db, selected.table.name); event.preventDefault(); }
    }
  }, [mentionQuery, mentionOptions, mentionIndex, selectMention]);

  const generateSql = useCallback(async () => {
    setLoadingFlag('ai', true);
    const names = extractTableMentions(aiInput);
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
    setChat((items) => [...items, { role: 'user', content: aiInput }]);
    const request = { prompt: aiInput, dialect: (activeConnection?.driver as 'mysql' | 'postgres') ?? 'mysql', tables: context };

    const useStream = defaultProvider?.streaming === true && api.generateSqlStream;
    if (!useStream) {
      try {
        const response: AiGenerateResponse = await api.generateSql(request);
        updateActiveWorkTab({ baseSql: response.sql, sql: response.sql, sort: undefined });
        setChat((items) => [...items, { role: 'assistant', content: response.explanation, sql: response.sql, warnings: response.warnings, meta: `${response.source === 'local' ? 'Local' : defaultProvider?.name ?? 'AI'} · 已注入 ${response.usedTables.join(', ') || selectedTable}` }]);
      } catch (error) {
        setChat((items) => [...items, { role: 'assistant', content: error instanceof Error ? error.message : 'AI 生成失败', meta: 'AI 错误' }]);
      } finally { setLoadingFlag('ai', false); }
      return;
    }

    // Streaming mode
    const msgIndex = chat.length + 1; // index of the new assistant message (0-based)
    setChat((items) => [...items, { role: 'assistant', content: '', meta: `${defaultProvider?.name ?? 'AI'} · 生成中...` }]);
    let streamedContent = '';

    try {
      await api.generateSqlStream(request, (chunk) => {
        if (chunk.error) {
          setChat((items) => {
            const copy = [...items];
            copy[msgIndex] = { role: 'assistant', content: chunk.error!, meta: 'AI 错误' };
            return copy;
          });
          setLoadingFlag('ai', false);
          return;
        }
        if (chunk.token) {
          streamedContent += chunk.token;
          setChat((items) => {
            const copy = [...items];
            copy[msgIndex] = { ...copy[msgIndex] as ChatMessage, content: streamedContent };
            return copy;
          });
        }
        if (chunk.done && chunk.sql) {
          updateActiveWorkTab({ baseSql: chunk.sql, sql: chunk.sql, sort: undefined });
          setChat((items) => {
            const copy = [...items];
            copy[msgIndex] = {
              role: 'assistant',
              content: chunk.explanation || streamedContent,
              sql: chunk.sql,
              warnings: chunk.warnings,
              meta: `${chunk.source === 'local' ? 'Local' : defaultProvider?.name ?? 'AI'} · 已注入 ${(chunk.usedTables || []).join(', ') || selectedTable}`
            };
            return copy;
          });
          setLoadingFlag('ai', false);
        }
      });
    } catch (error) {
      setChat((items) => {
        const copy = [...items];
        copy[msgIndex] = { role: 'assistant', content: error instanceof Error ? error.message : 'AI 生成失败', meta: 'AI 错误' };
        return copy;
      });
    } finally {
      setLoadingFlag('ai', false);
    }
  }, [aiInput, schemaMap, allTables, selectedSchema, api, activeConnection, updateActiveWorkTab, defaultProvider, setLoadingFlag, selectedTable, chat.length]);

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
      const ddl = await api.getTableDdl(activeConnectionId, selectedSchema.name);
      const nextSql = ddl || `-- 未读取到 ${selectedSchema.name} 的 DDL`;
      updateActiveWorkTab({ baseSql: nextSql, sql: nextSql, sort: undefined });
      setNotice(`已读取 ${selectedSchema.name} 的建表 DDL`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'DDL 读取失败'); }
  }, [selectedSchema, api, activeConnectionId, updateActiveWorkTab, setNotice]);

  const browseSelectedTable = useCallback(() => {
    if (!selectedSchema) { setNotice('请先选择一张表。'); return; }
    // Caller passes openTableTab
  }, [selectedSchema, setNotice]);

  return {
    aiInput, setAiInput, chat, setChat,
    textareaRef, mentionQuery, mentionIndex, mentionedTables, mentionOptions,
    handleAiChange, selectMention, handleAiKeyDown,
    generateSql, insertTableSelect, insertTableCount, loadTableDdl, browseSelectedTable
  };
}
