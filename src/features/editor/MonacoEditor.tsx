import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react';
import { useRef, useCallback, useEffect } from 'react';
import type * as Monaco from 'monaco-editor';
import { useUiStore } from '../../shared/stores/uiStore';
import { currentStatement, searchAllTables } from '../../shared/api/tauri';

interface MonacoEditorProps {
  value: string;
  database?: string;
  errorLine?: number;
  onChange: (value: string) => void;
  onExecute?: (sql?: string) => void;
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'ON',
  'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW',
  'NULL', 'IS', 'LIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'AS', 'ASC', 'DESC', 'DISTINCT', 'UNION', 'ALL', 'ANY',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT',
  'DEFAULT', 'CHECK', 'UNIQUE', 'CASCADE', 'RESTRICT',
  'TRANSACTION', 'BEGIN', 'COMMIT', 'ROLLBACK',
  'INT', 'BIGINT', 'VARCHAR', 'TEXT', 'BOOLEAN', 'TIMESTAMP', 'DATE',
];

const defineThemes = (monaco: typeof Monaco) => {
  monaco.editor.defineTheme('dbmind-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '4c9aff', fontStyle: 'bold' },
      { token: 'string', foreground: '51cf66' },
      { token: 'number', foreground: 'da77f2' },
      { token: 'comment', foreground: '5c5f66', fontStyle: 'italic' },
      { token: 'identifier', foreground: 'c1c2c5' },
    ],
    colors: {
      'editor.background': '#1a1b1e',
      'editor.foreground': '#c1c2c5',
      'editor.lineHighlightBackground': '#25262b',
      'editor.selectionBackground': '#373a40',
      'editorCursor.foreground': '#c1c2c5',
      'editorLineNumber.foreground': '#5c5f66',
      'editorLineNumber.activeForeground': '#909296',
      'editorError.foreground': '#ff6b6b',
    },
  });

  monaco.editor.defineTheme('dbmind-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword', foreground: '228be6', fontStyle: 'bold' },
      { token: 'string', foreground: '2b8a3e' },
      { token: 'number', foreground: 'ae3ec9' },
      { token: 'comment', foreground: '868e96', fontStyle: 'italic' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#212529',
      'editor.lineHighlightBackground': '#f8f9fa',
      'editorCursor.foreground': '#212529',
      'editorError.foreground': '#fa5252',
    },
  });
};

function quoteIdentifier(identifier: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)
    ? identifier
    : `\`${identifier.replace(/`/g, '``')}\``;
}

export function MonacoEditor({ value, database, errorLine, onChange, onExecute }: MonacoEditorProps) {
  const theme = useUiStore((s) => s.theme);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const errorDecorationsRef = useRef<string[]>([]);

  // beforeMount: fires BEFORE the editor is created — define themes here
  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    defineThemes(monaco);
  }, []);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Register SQL completion provider
    monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.', '`'],
      provideCompletionItems: async (model: Monaco.editor.ITextModel, position: Monaco.Position) => {
        const word = model.getWordUntilPosition(position);
        const range: Monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        const suggestions: Monaco.languages.CompletionItem[] = SQL_KEYWORDS.map(
          (kw) => ({
            label: kw,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: kw,
            range,
            sortText: '1' + kw,
          }),
        );

        const query = word.word.trim();
        const schemaTables = await searchAllTables(query).catch(() => []);
        for (const table of schemaTables) {
          const tableRef = `${quoteIdentifier(table.database)}.${quoteIdentifier(table.name)}`;
          suggestions.push({
            label: `${table.database}.${table.name}`,
            kind: monaco.languages.CompletionItemKind.Class,
            insertText: tableRef,
            detail: `${table.columns.length} columns`,
            documentation: table.comment,
            range,
            sortText: `0table:${table.database}.${table.name}`,
          });
          for (const column of table.columns) {
            suggestions.push({
              label: column.name,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: quoteIdentifier(column.name),
              detail: `${table.database}.${table.name} · ${column.data_type}`,
              documentation: column.comment,
              range,
              sortText: `0column:${column.name}`,
            });
          }
        }

        suggestions.push(
          {
            label: 'SELECT * FROM',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText:
              'SELECT *\nFROM ${1:table}\nWHERE ${2:condition}\nLIMIT 100;',
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: '0select',
          },
          {
            label: 'INSERT INTO',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText:
              'INSERT INTO ${1:table} (${2:columns})\nVALUES (${3:values});',
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: '0insert',
          },
          {
            label: 'COUNT',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText:
              'SELECT COUNT(*)\nFROM ${1:table}\nWHERE ${2:condition};',
            insertTextRules:
              monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: '0count',
          },
        );

        return { suggestions };
      },
    });

    // Cmd+Enter to execute
    editor.addAction({
      id: 'execute-query',
      label: 'Execute Current Statement',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: async () => {
        const selection = editor.getSelection();
        const model = editor.getModel();
        if (!model) {
          onExecute?.();
          return;
        }

        const selectedSql = selection ? model.getValueInRange(selection).trim() : '';
        if (selectedSql) {
          onExecute?.(selectedSql);
          return;
        }

        const position = editor.getPosition();
        const offset = position ? model.getOffsetAt(position) : model.getValueLength();
        const statement = await currentStatement(model.getValue(), offset);
        onExecute?.(statement ?? undefined);
      },
    });

    editor.focus();
  }, [onExecute]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    errorDecorationsRef.current = editor.deltaDecorations(
      errorDecorationsRef.current,
      errorLine
        ? [
            {
              range: new monaco.Range(errorLine, 1, errorLine, 1),
              options: {
                isWholeLine: true,
                className: 'sql-error-line',
                glyphMarginClassName: 'sql-error-glyph',
                overviewRuler: {
                  color: '#ff6b6b',
                  position: monaco.editor.OverviewRulerLane.Right,
                },
              },
            },
          ]
        : [],
    );
  }, [errorLine]);

  const monacoTheme = theme === 'dark' ? 'dbmind-dark' : 'dbmind-light';

  return (
    <Editor
      height="100%"
      language="sql"
      theme={monacoTheme}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        fontSize: 14,
        fontFamily:
          "var(--font-mono, 'SF Mono', 'Cascadia Code', Consolas, monospace)",
        tabSize: 2,
        minimap: { enabled: false },
        lineNumbers: 'on',
        glyphMargin: true,
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        folding: true,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        automaticLayout: true,
        padding: { top: 12 },
        suggest: { showKeywords: true, showSnippets: true },
      }}
      loading={
        <div className="sql-editor-empty">
          <p>Loading editor...</p>
        </div>
      }
    />
  );
}
