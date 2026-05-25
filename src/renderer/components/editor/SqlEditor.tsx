import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution';
import { format as formatSql } from 'sql-formatter';
import type { TableSchema } from '../../../shared/types';

type CompletionKind = 'keyword' | 'database' | 'table' | 'column';

interface Completion {
  label: string;
  kind: CompletionKind;
  sub?: string;
}

const SQL_COMPLETIONS: Completion[] = [
  ...[
    'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
    'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN', 'ON', 'AS',
    'GROUP BY', 'ORDER BY', 'ASC', 'DESC', 'HAVING', 'LIMIT', 'OFFSET', 'UNION ALL',
    'DISTINCT', 'CASE WHEN', 'THEN', 'ELSE', 'END', 'BETWEEN', 'LIKE', 'REGEXP',
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'IFNULL', 'CAST', 'CONVERT',
    'CONCAT', 'SUBSTRING', 'TRIM', 'UPPER', 'LOWER', 'LENGTH', 'REPLACE',
    'NOW', 'CURDATE', 'DATE_FORMAT', 'DATE_ADD', 'DATE_SUB', 'DATEDIFF',
    'ROUND', 'FLOOR', 'CEIL', 'ABS', 'GREATEST', 'LEAST', 'IF',
    'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'LAG', 'LEAD',
    'EXPLAIN', 'SHOW', 'DESCRIBE', 'USE', 'BEGIN', 'COMMIT', 'ROLLBACK',
  ].map((label) => ({ label, kind: 'keyword' as const })),
];

const KEYWORDS_NEEDING_SPACE = /^(SELECT|FROM|WHERE|AND|OR|SET|ON|AS|IN|IS|BY|JOIN|INTO|VALUES|LIMIT|DESC|ASC|ALL|END)$/i;

let monacoConfigured = false;

function configureMonaco() {
  if (monacoConfigured) return;

  (globalThis as typeof globalThis & { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
    getWorker() {
      return new editorWorker();
    },
  };

  monaco.editor.defineTheme('dbmind-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword.sql', foreground: 'c792ea', fontStyle: 'bold' },
      { token: 'predefined.sql', foreground: '82aaff' },
      { token: 'string.sql', foreground: 'c3e88d' },
      { token: 'number.sql', foreground: 'f78c6c' },
      { token: 'comment.sql', foreground: '676e95', fontStyle: 'italic' },
      { token: 'operator.sql', foreground: '89ddff' },
    ],
    colors: {
      'editor.background': '#0f0f17',
      'editor.foreground': '#d9d9e6',
      'editorLineNumber.foreground': '#59596d',
      'editorLineNumber.activeForeground': '#ececf5',
      'editorCursor.foreground': '#ececf5',
      'editor.selectionBackground': '#8b7cff4d',
      'editor.inactiveSelectionBackground': '#8b7cff25',
      'editorSuggestWidget.background': '#1c1c28',
      'editorSuggestWidget.border': '#ffffff24',
      'editorSuggestWidget.foreground': '#ececf5',
      'editorSuggestWidget.selectedBackground': '#8b7cff2e',
      'editorSuggestWidget.highlightForeground': '#8b7cff',
    },
  });

  monaco.editor.defineTheme('dbmind-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword.sql', foreground: '7c3aed', fontStyle: 'bold' },
      { token: 'predefined.sql', foreground: '2563eb' },
      { token: 'string.sql', foreground: '059669' },
      { token: 'number.sql', foreground: 'dc2626' },
      { token: 'comment.sql', foreground: '9ca3af', fontStyle: 'italic' },
      { token: 'operator.sql', foreground: '0ea5e9' },
    ],
    colors: {
      'editor.background': '#f2f5fa',
      'editor.foreground': '#22304a',
      'editorLineNumber.foreground': '#8a93a5',
      'editorLineNumber.activeForeground': '#172033',
      'editorCursor.foreground': '#22304a',
      'editor.selectionBackground': '#4f46e52e',
      'editor.inactiveSelectionBackground': '#4f46e51c',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#20293938',
      'editorSuggestWidget.foreground': '#172033',
      'editorSuggestWidget.selectedBackground': '#4f46e51f',
      'editorSuggestWidget.highlightForeground': '#4f46e5',
    },
  });

  monacoConfigured = true;
}

function getThemeName() {
  return document.querySelector('.app-shell')?.classList.contains('theme-light') ? 'dbmind-light' : 'dbmind-dark';
}

function getCurrentWord(text: string, cursor: number): { word: string; start: number; end: number } | null {
  const before = text.slice(0, cursor);
  const match = before.match(/([\w.`]+)$/);
  if (!match || typeof match.index !== 'number') return null;
  return { word: match[1], start: match.index, end: cursor };
}

function stripIdentifierQuotes(value: string): string {
  return value.trim().replace(/^`+|`+$/g, '');
}

function normalizeIdentifier(value: string): string {
  return stripIdentifierQuotes(value).toLowerCase();
}

function startsWithIdentifier(value: string, prefix: string): boolean {
  return normalizeIdentifier(value).startsWith(normalizeIdentifier(prefix));
}

function splitSqlPath(word: string): string[] {
  return word.split('.').map(stripIdentifierQuotes);
}

function findSchemaKey(schemaMap: Record<string, TableSchema[]>, dbName: string): string | undefined {
  const target = normalizeIdentifier(dbName);
  return Object.keys(schemaMap).find((key) => key.toLowerCase() === target);
}

function findTable(tables: TableSchema[] | undefined, tableName: string): TableSchema | undefined {
  const target = normalizeIdentifier(tableName);
  return tables?.find((table) => table.name.toLowerCase() === target);
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }

  return result;
}

function knownDatabaseNames(schemaMap: Record<string, TableSchema[]>, selectedDbs: string[], databaseNames: string[]): string[] {
  return uniqueNames([...selectedDbs, ...databaseNames, ...Object.keys(schemaMap)]);
}

function activeDatabaseNames(schemaMap: Record<string, TableSchema[]>, selectedDbs: string[], databaseNames: string[]): string[] {
  const knownDbs = knownDatabaseNames(schemaMap, selectedDbs, databaseNames);
  return selectedDbs.length ? selectedDbs : knownDbs;
}

function collectTableAliases(
  text: string,
  schemaMap: Record<string, TableSchema[]>,
  selectedDbs: string[],
  databaseNames: string[],
  currentDb?: string
): Record<string, { dbName?: string; tableName: string }> {
  const aliases: Record<string, { dbName?: string; tableName: string }> = {};
  const activeDbs = activeDatabaseNames(schemaMap, selectedDbs, databaseNames);
  const sourcePattern = /\b(?:from|join)\s+((?:`[^`]+`|\w+)(?:\s*\.\s*(?:`[^`]+`|\w+))?)(?:\s+(?:as\s+)?(`[^`]+`|\w+))?/gi;
  let match: RegExpExecArray | null;

  while ((match = sourcePattern.exec(text))) {
    const source = match[1].replace(/\s+/g, '');
    const alias = match[2] ? stripIdentifierQuotes(match[2]) : '';
    const parts = splitSqlPath(source);
    const tableName = parts.length > 1 ? parts[1] : parts[0];
    let dbName = parts.length > 1 ? findSchemaKey(schemaMap, parts[0]) : currentDb;

    if (!dbName && tableName) {
      dbName = activeDbs.find((db) => findTable(schemaMap[db], tableName));
    }

    if (alias && tableName && !SQL_COMPLETIONS.some((item) => item.label.toLowerCase() === alias.toLowerCase())) {
      aliases[alias.toLowerCase()] = { dbName, tableName };
    }
  }

  return aliases;
}

function filterCompletions(
  word: string,
  textBeforeCursor: string,
  schemaMap: Record<string, TableSchema[]>,
  selectedDbs: string[],
  databaseNames: string[],
  currentDb?: string
): Completion[] {
  const lower = normalizeIdentifier(word);
  const results: Completion[] = [];
  const activeDbs = activeDatabaseNames(schemaMap, selectedDbs, databaseNames);
  const knownDbs = knownDatabaseNames(schemaMap, selectedDbs, databaseNames);
  const aliases = collectTableAliases(textBeforeCursor, schemaMap, selectedDbs, databaseNames, currentDb);
  const pushUnique = (completion: Completion) => {
    const key = `${completion.kind}:${completion.label}:${completion.sub ?? ''}`;
    if (!results.some((item) => `${item.kind}:${item.label}:${item.sub ?? ''}` === key)) {
      results.push(completion);
    }
  };

  if (word.includes('.')) {
    const parts = splitSqlPath(word);
    const suffix = parts.at(-1) ?? '';
    const suffixClean = normalizeIdentifier(suffix);

    if (parts.length === 2) {
      const prefix = parts[0];
      const dbKey = findSchemaKey(schemaMap, prefix);

      if (dbKey) {
        const dbTables = schemaMap[dbKey] ?? [];
        for (const table of dbTables) {
          if (startsWithIdentifier(table.name, suffixClean)) {
            pushUnique({ label: table.name, kind: 'table', sub: dbKey });
          }
        }
        return results.slice(0, 50);
      }

      const aliasTarget = aliases[normalizeIdentifier(prefix)];
      if (aliasTarget) {
        const dbKeyForAlias = aliasTarget.dbName ? findSchemaKey(schemaMap, aliasTarget.dbName) : undefined;
        const aliasTable = findTable(dbKeyForAlias ? schemaMap[dbKeyForAlias] : undefined, aliasTarget.tableName);
        if (aliasTable) {
          for (const column of aliasTable.columns) {
            if (startsWithIdentifier(column.name, suffixClean)) {
              pushUnique({ label: column.name, kind: 'column', sub: `${aliasTable.name} · ${column.type}` });
            }
          }
          return results.slice(0, 50);
        }
      }

      for (const dbName of activeDbs) {
        const table = findTable(schemaMap[dbName], prefix);
        if (!table) continue;

        for (const column of table.columns) {
          if (startsWithIdentifier(column.name, suffixClean)) {
            pushUnique({ label: column.name, kind: 'column', sub: `${dbName} · ${column.type}` });
          }
        }
        return results.slice(0, 50);
      }

      return results;
    }

    if (parts.length >= 3) {
      const dbKey = findSchemaKey(schemaMap, parts[parts.length - 3]);
      const tableName = parts[parts.length - 2];
      const table = findTable(dbKey ? schemaMap[dbKey] : undefined, tableName);

      if (table) {
        for (const column of table.columns) {
          if (startsWithIdentifier(column.name, suffixClean)) {
            pushUnique({ label: column.name, kind: 'column', sub: `${dbKey} · ${table.name} · ${column.type}` });
          }
        }
      }

      return results.slice(0, 50);
    }

    return results;
  }

  for (const completion of SQL_COMPLETIONS) {
    if (completion.label.toLowerCase().startsWith(lower)) {
      pushUnique(completion);
    }
  }

  for (const db of knownDbs) {
    if (startsWithIdentifier(db, lower)) {
      pushUnique({ label: db, kind: 'database', sub: 'database' });
    }
  }

  for (const db of activeDbs) {
    const tables = schemaMap[db];
    if (!tables) continue;
    for (const table of tables) {
      if (startsWithIdentifier(table.name, lower)) {
        pushUnique({ label: table.name, kind: 'table', sub: db });
      }
    }
  }

  const primaryDb = currentDb || selectedDbs[0];
  if (primaryDb) {
    const primaryDbKey = findSchemaKey(schemaMap, primaryDb);
    const tables = primaryDbKey ? schemaMap[primaryDbKey] : undefined;
    if (tables) {
      for (const table of tables) {
        if (startsWithIdentifier(table.name, lower)) {
          pushUnique({ label: table.name, kind: 'table', sub: primaryDbKey });
        }
      }
    }
  }

  for (const dbName of activeDbs) {
    const tables = schemaMap[dbName];
    if (!tables) continue;
    for (const table of tables) {
      for (const column of table.columns) {
        if (startsWithIdentifier(column.name, lower)) {
          pushUnique({ label: column.name, kind: 'column', sub: `${dbName} · ${table.name} · ${column.type}` });
        }
      }
    }
  }

  return results.slice(0, 50);
}

function completionKind(kind: CompletionKind) {
  if (kind === 'database') return monaco.languages.CompletionItemKind.Module;
  if (kind === 'table') return monaco.languages.CompletionItemKind.Class;
  if (kind === 'column') return monaco.languages.CompletionItemKind.Field;
  return monaco.languages.CompletionItemKind.Keyword;
}

function insertionText(completion: Completion) {
  if (completion.kind !== 'keyword') return completion.label;
  const insert = completion.label.toUpperCase();
  return KEYWORDS_NEEDING_SPACE.test(insert) ? `${insert} ` : insert;
}

export const SqlEditor = memo(function SqlEditor({
  value,
  onChange,
  onRunQuery,
  schemaMap,
  selectedDbs,
  databaseNames,
  currentDb,
}: {
  value: string;
  onChange: (value: string) => void;
  onRunQuery?: (sql?: string) => void;
  schemaMap: Record<string, TableSchema[]>;
  selectedDbs: string[];
  databaseNames?: string[];
  currentDb?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const isUpdatingFromProps = useRef(false);
  const glyphDecos = useRef<string[]>([]);
  const glyphTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onRunQueryRef = useRef(onRunQuery);
  onRunQueryRef.current = onRunQuery;

  const completionProvider = useMemo(
    () => ({
      provideCompletionItems(model: monaco.editor.ITextModel, position: monaco.Position): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
        const text = model.getValue();
        const offset = model.getOffsetAt(position);
        const wordInfo = getCurrentWord(text, offset);
        const modelWord = model.getWordUntilPosition(position);
        const fallbackStart = new monaco.Position(position.lineNumber, modelWord.startColumn);
        const fallbackEnd = new monaco.Position(position.lineNumber, modelWord.endColumn);
        const replaceStartOffset = wordInfo && wordInfo.word.includes('.') ? wordInfo.start + wordInfo.word.lastIndexOf('.') + 1 : wordInfo?.start;
        const start = typeof replaceStartOffset === 'number' ? model.getPositionAt(replaceStartOffset) : fallbackStart;
        const end = wordInfo ? model.getPositionAt(wordInfo.end) : fallbackEnd;
        const typedWord = wordInfo?.word ?? modelWord.word;
        const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);

        if (!typedWord && text[offset - 1] !== '.') {
          return { suggestions: [] };
        }

        const suggestions = filterCompletions(typedWord, text.slice(0, offset), schemaMap, selectedDbs, databaseNames ?? [], currentDb).map((item) => ({
          label: item.label,
          kind: completionKind(item.kind),
          detail: item.sub,
          insertText: insertionText(item),
          range,
          sortText:
            item.kind === 'keyword'
              ? `1_${item.label}`
              : item.kind === 'database'
                ? `2_${item.label}`
                : item.kind === 'table'
                  ? `3_${item.label}`
                  : `4_${item.label}`,
        }));

        return { suggestions };
      },
    }),
    [currentDb, databaseNames, schemaMap, selectedDbs]
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    valueRef.current = value;
    const editor = editorRef.current;
    if (!editor || editor.getValue() === value) return;

    isUpdatingFromProps.current = true;
    editor.setValue(value);
    isUpdatingFromProps.current = false;
  }, [value]);

  useEffect(() => {
    configureMonaco();
    const host = hostRef.current;
    if (!host) return;

    const editor = monaco.editor.create(host, {
      value,
      language: 'sql',
      theme: getThemeName(),
      automaticLayout: true,
      minimap: { enabled: false },
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 23,
      lineNumbersMinChars: 3,
      glyphMargin: true,
      padding: { top: 18, bottom: 18 },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'gutter',
      roundedSelection: false,
      smoothScrolling: true,
      tabSize: 2,
      wordWrap: 'off',
      quickSuggestions: { other: true, comments: false, strings: false },
      quickSuggestionsDelay: 80,
      suggestOnTriggerCharacters: true,
      suggest: { showWords: false },
      wordBasedSuggestions: 'off',
      acceptSuggestionOnEnter: 'on',
      fixedOverflowWidgets: true,
      overviewRulerLanes: 0,
    });

    editorRef.current = editor;

    // Format SQL (Ctrl/Cmd+Shift+F)
    editor.addAction({
      id: 'dbmind.formatSql',
      label: '格式化 SQL',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF],
      run: (ed) => {
        const model = ed.getModel();
        if (!model) return;
        try {
          const formatted = formatSql(model.getValue(), { language: 'mysql', tabWidth: 2 });
          ed.executeEdits('format', [{ range: model.getFullModelRange(), text: formatted }]);
        } catch { /* invalid SQL, ignore */ }
      }
    });

    // Right-click: execute selected SQL
    editor.addAction({
      id: 'dbmind.runSelection',
      label: '执行选中的 SQL',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.1,
      run: (ed) => {
        const model = ed.getModel();
        if (!model) return;
        const selection = ed.getSelection();
        if (!selection || selection.isEmpty()) return;
        const text = model.getValueInRange(selection)?.trim();
        if (text) {
          onRunQueryRef.current?.(text);
        }
      }
    });

    const contentDisposable = editor.onDidChangeModelContent((event) => {
      if (isUpdatingFromProps.current) return;
      const nextValue = editor.getValue();
      valueRef.current = nextValue;
      onChangeRef.current(nextValue);

      const shouldSuggest = event.changes.some((change) => /^[\w.`]+$/.test(change.text));
      if (shouldSuggest) {
        window.setTimeout(() => {
          editor.trigger('dbmind', 'editor.action.triggerSuggest', {});
        }, 0);
      }
    });

    const gutterDisposable = editor.onMouseDown((e) => {
      if (!onRunQueryRef.current) return;
      const target = e.target;
      if (target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
        const model = editor.getModel();
        if (!model || !target.position) { onRunQueryRef.current(); return; }
        const lineNumber = target.position.lineNumber;
        const fullText = model.getValue();
        // Walk backward from clicked line to find statement start (after previous ; or doc start)
        let lineStart = lineNumber;
        while (lineStart > 1) {
          const prevLine = model.getLineContent(lineStart - 1).trim();
          if (prevLine.endsWith(';')) break;
          lineStart--;
        }
        // Walk forward from clicked line to find statement end (before next ; or doc end)
        const totalLines = model.getLineCount();
        let lineEnd = lineNumber;
        while (lineEnd < totalLines) {
          const currLine = model.getLineContent(lineEnd).trim();
          if (currLine.endsWith(';')) break;
          lineEnd++;
        }
        // If lineStart == 1 and lineEnd == totalLines, execute everything
        if (lineStart === 1 && lineEnd === totalLines) {
          onRunQueryRef.current();
          return;
        }
        const startOffset = model.getOffsetAt({ lineNumber: lineStart, column: 1 });
        const endLineContent = model.getLineContent(lineEnd);
        const endOffset = model.getOffsetAt({ lineNumber: lineEnd, column: endLineContent.length + 1 });
        const statement = fullText.slice(startOffset, endOffset).trim().replace(/;+\s*$/, '');
        if (statement.length > 0) {
          onRunQueryRef.current(statement);
        }
      }
    });

    const updateGlyphs = () => {
      if (!onRunQueryRef.current) return;
      const model = editor.getModel();
      if (!model) return;
      const count = model.getLineCount();
      const decos: monaco.editor.IModelDeltaDecoration[] = [];
      let isNewStatement = true;
      for (let i = 1; i <= count; i++) {
        const text = model.getLineContent(i).trim();
        if (text.length === 0 || text.startsWith('--')) {
          continue;
        }
        if (isNewStatement) {
          decos.push({
            range: new monaco.Range(i, 1, i, 1),
            options: {
              glyphMarginClassName: 'sql-run-glyph',
              glyphMarginHoverMessage: { value: '执行语句' },
            },
          });
          isNewStatement = false;
        }
        if (text.endsWith(';')) {
          isNewStatement = true;
        }
      }
      glyphDecos.current = editor.deltaDecorations(glyphDecos.current, decos);
    };

    const modelDisposable = editor.onDidChangeModelContent(() => {
      clearTimeout(glyphTimerRef.current);
      glyphTimerRef.current = setTimeout(updateGlyphs, 200);
    });
    updateGlyphs();

    const themeTarget = document.querySelector('.app-shell') ?? document.documentElement;
    const themeObserver = new MutationObserver(() => {
      monaco.editor.setTheme(getThemeName());
    });
    themeObserver.observe(themeTarget, { attributes: true, attributeFilter: ['class'] });

    return () => {
      contentDisposable.dispose();
      gutterDisposable.dispose();
      modelDisposable.dispose();
      themeObserver.disconnect();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const provider = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', '`'],
      provideCompletionItems: completionProvider.provideCompletionItems,
    });
    return () => provider.dispose();
  }, [completionProvider]);

  const focusEditor = useCallback(() => {
    editorRef.current?.focus();
  }, []);

  return (
    <div className="sql-editor-wrap" onClick={focusEditor}>
      <div ref={hostRef} className="sql-monaco-editor" />
    </div>
  );
});
