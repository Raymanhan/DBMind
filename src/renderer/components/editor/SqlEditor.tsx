import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TableSchema } from '../../../shared/types';

/* ---------- SQL keywords ---------- */
const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'ALTER', 'DROP',
  'TABLE', 'INDEX', 'VIEW', 'DATABASE', 'SCHEMA', 'COLUMN', 'ADD', 'MODIFY', 'CHANGE',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL', 'ON', 'AS',
  'GROUP', 'BY', 'ORDER', 'ASC', 'DESC', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL',
  'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'IF', 'EXISTS', 'BETWEEN',
  'LIKE', 'REGEXP', 'RLIKE', 'ANY', 'SOME', 'PRIMARY', 'KEY', 'FOREIGN',
  'REFERENCES', 'CONSTRAINT', 'UNIQUE', 'CHECK', 'DEFAULT', 'AUTO_INCREMENT',
  'CASCADE', 'RESTRICT', 'NO', 'ACTION', 'TRUNCATE', 'RENAME', 'REPLACE',
  'USE', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'ANALYZE', 'WITH', 'RECURSIVE',
  'PARTITION', 'OVER', 'WINDOW', 'LATERAL', 'NATURAL', 'USING', 'FORCE',
  'IGNORE', 'STRAIGHT_JOIN', 'SQL_CALC_FOUND_ROWS', 'SQL_NO_CACHE', 'SQL_BUFFER_RESULT',
  'HIGH_PRIORITY', 'LOW_PRIORITY', 'DELAYED', 'QUICK', 'LOCK', 'UNLOCK',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'START', 'TRANSACTION',
  'TEMPORARY', 'IF', 'NOT', 'EXISTS', 'CHARACTER', 'COLLATE', 'ENGINE',
  'COMMENT', 'AFTER', 'FIRST', 'BEFORE', 'EACH', 'ROW', 'TRIGGER',
  'FUNCTION', 'PROCEDURE', 'EVENT', 'GRANT', 'REVOKE', 'PRIVILEGES',
  'TO', 'IDENTIFIED', 'FLUSH', 'KILL', 'LOAD', 'DATA', 'INFILE',
  'XOR', 'DIV', 'MOD', 'BINARY', 'ESCAPE', 'LIKE', 'SOUNDS',
]);

const FUNCTIONS = new Set([
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'GROUP_CONCAT', 'COALESCE', 'IFNULL',
  'NULLIF', 'CAST', 'CONVERT', 'CONCAT', 'SUBSTRING', 'SUBSTR', 'LEFT', 'RIGHT',
  'TRIM', 'LTRIM', 'RTRIM', 'UPPER', 'LOWER', 'LENGTH', 'CHAR_LENGTH',
  'REPLACE', 'REVERSE', 'REPEAT', 'LPAD', 'RPAD', 'INSTR', 'LOCATE', 'POSITION',
  'NOW', 'CURDATE', 'CURTIME', 'DATE', 'TIME', 'YEAR', 'MONTH', 'DAY',
  'HOUR', 'MINUTE', 'SECOND', 'DAYOFWEEK', 'DAYOFMONTH', 'DAYOFYEAR',
  'WEEK', 'QUARTER', 'DATE_FORMAT', 'TIME_FORMAT', 'STR_TO_DATE',
  'DATE_ADD', 'DATE_SUB', 'DATEDIFF', 'TIMEDIFF', 'TIMESTAMPDIFF',
  'UNIX_TIMESTAMP', 'FROM_UNIXTIME', 'EXTRACT', 'LAST_DAY', 'MAKEDATE',
  'ABS', 'CEIL', 'CEILING', 'FLOOR', 'ROUND', 'TRUNCATE', 'RAND',
  'POW', 'POWER', 'SQRT', 'EXP', 'LOG', 'LOG10', 'LOG2', 'SIGN',
  'GREATEST', 'LEAST', 'BIT_COUNT', 'CRC32', 'MD5', 'SHA1', 'SHA2',
  'UUID', 'UUID_SHORT', 'JSON_EXTRACT', 'JSON_OBJECT', 'JSON_ARRAY',
  'JSON_SET', 'JSON_REMOVE', 'JSON_CONTAINS', 'JSON_KEYS', 'JSON_LENGTH',
  'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD',
  'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE', 'CUME_DIST', 'PERCENT_RANK',
  'IF', 'IFNULL', 'COALESCE', 'NULLIF', 'BIN', 'HEX', 'CONV',
]);

const TYPES = new Set([
  'INT', 'INTEGER', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT',
  'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC', 'REAL',
  'CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'BINARY', 'VARBINARY', 'TINYBLOB', 'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'ENUM', 'SET', 'JSON', 'GEOMETRY', 'POINT', 'LINESTRING', 'POLYGON',
  'BOOLEAN', 'BOOL', 'BIT', 'SERIAL', 'SERIAL4', 'SERIAL8',
  'UNSIGNED', 'SIGNED', 'ZEROFILL',
]);

/* ---------- Tokenizer ---------- */
type TokenKind = 'keyword' | 'function' | 'type' | 'string' | 'number' | 'comment' | 'operator' | 'identifier' | 'backtick' | 'space' | 'paren' | 'other';

interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < sql.length) {
    // whitespace
    if (/\s/.test(sql[i])) {
      const start = i;
      while (i < sql.length && /\s/.test(sql[i])) i++;
      tokens.push({ kind: 'space', value: sql.slice(start, i), start, end: i });
      continue;
    }
    // single-line comment --
    if (sql[i] === '-' && sql[i + 1] === '-') {
      const start = i;
      while (i < sql.length && sql[i] !== '\n') i++;
      tokens.push({ kind: 'comment', value: sql.slice(start, i), start, end: i });
      continue;
    }
    // multi-line comment /* */
    if (sql[i] === '/' && sql[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      if (i < sql.length) i += 2;
      tokens.push({ kind: 'comment', value: sql.slice(start, i), start, end: i });
      continue;
    }
    // string literals '...' or "..." (MySQL allows double-quoted strings in some modes)
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      const start = i;
      i++;
      while (i < sql.length && sql[i] !== quote) {
        if (sql[i] === '\\') i++; // skip escaped chars
        i++;
      }
      if (i < sql.length) i++; // consume closing quote
      tokens.push({ kind: 'string', value: sql.slice(start, i), start, end: i });
      continue;
    }
    // backtick identifiers `...`
    if (sql[i] === '`') {
      const start = i;
      i++;
      while (i < sql.length && sql[i] !== '`') i++;
      if (i < sql.length) i++;
      tokens.push({ kind: 'backtick', value: sql.slice(start, i), start, end: i });
      continue;
    }
    // numbers
    if (/[0-9]/.test(sql[i]) || (sql[i] === '.' && /[0-9]/.test(sql[i + 1]))) {
      const start = i;
      while (i < sql.length && /[0-9.eExXa-fA-F]/.test(sql[i])) i++;
      tokens.push({ kind: 'number', value: sql.slice(start, i), start, end: i });
      continue;
    }
    // operators and punctuation
    if (/[<>!=+\-*\/%&|^~.,;:()[\]]/.test(sql[i])) {
      const start = i;
      const ch = sql[i];
      i++;
      // multi-char operators
      if ((ch === '<' || ch === '>' || ch === '!' || ch === '=') && sql[i] === '=') i++;
      else if (ch === '<' && sql[i] === '>') i++;
      else if (ch === '|' && sql[i] === '|') i++;
      else if (ch === '&' && sql[i] === '&') i++;
      tokens.push({ kind: 'paren', value: sql.slice(start, i), start, end: i });
      continue;
    }
    // identifiers / keywords
    {
      const start = i;
      while (i < sql.length && /[a-zA-Z0-9_$]/.test(sql[i])) i++;
      const word = sql.slice(start, i);
      const upper = word.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ kind: 'keyword', value: word, start, end: i });
      } else if (FUNCTIONS.has(upper) && (i >= sql.length || sql[i] === '(' || /\s/.test(sql[i]))) {
        tokens.push({ kind: 'function', value: word, start, end: i });
      } else if (TYPES.has(upper)) {
        tokens.push({ kind: 'type', value: word, start, end: i });
      } else if (upper === 'NULL' || upper === 'TRUE' || upper === 'FALSE') {
        tokens.push({ kind: 'keyword', value: word, start, end: i });
      } else {
        tokens.push({ kind: 'identifier', value: word, start, end: i });
      }
      continue;
    }
  }

  return tokens;
}

/* ---------- HTML highlighter ---------- */
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tokensToHtml(tokens: Token[]): string {
  return tokens
    .map((token) => {
      const escaped = escapeHtml(token.value);
      switch (token.kind) {
        case 'keyword': return `<span class="sql-kw">${escaped}</span>`;
        case 'function': return `<span class="sql-fn">${escaped}</span>`;
        case 'type': return `<span class="sql-type">${escaped}</span>`;
        case 'string': return `<span class="sql-str">${escaped}</span>`;
        case 'number': return `<span class="sql-num">${escaped}</span>`;
        case 'comment': return `<span class="sql-cmt">${escaped}</span>`;
        case 'backtick': return `<span class="sql-bt">${escaped}</span>`;
        case 'paren': return `<span class="sql-paren">${escaped}</span>`;
        default: return escaped;
      }
    })
    .join('');
}

/* ---------- Autocomplete ---------- */
const SQL_COMPLETIONS: { label: string; kind: string }[] = [
  ...['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'TRUE', 'FALSE',
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
  ].map((label) => ({ label, kind: 'keyword' })),
];

interface Completion {
  label: string;
  kind: 'keyword' | 'table' | 'column';
  sub?: string;
}

function getCurrentWord(text: string, cursor: number): { word: string; start: number; end: number } | null {
  const before = text.slice(0, cursor);
  const match = before.match(/([\w.`]+)$/);
  if (!match) return null;
  return { word: match[1], start: match.index!, end: cursor };
}

function filterCompletions(
  word: string,
  schemaMap: Record<string, TableSchema[]>,
  selectedDbs: string[],
  currentDb?: string
): Completion[] {
  const lower = word.toLowerCase().replace(/^`|`$/g, '');
  const results: Completion[] = [];

  if (lower.includes('.')) {
    // db.table or table.column context
    const [prefix, suffix] = lower.split('.');
    const prefixClean = prefix.replace(/^`|`$/g, '');
    const suffixClean = (suffix || '').replace(/^`|`$/g, '').toLowerCase();

    // Check if prefix is a database name
    const dbTables = schemaMap[prefixClean];
    if (dbTables) {
      for (const t of dbTables) {
        if (t.name.toLowerCase().startsWith(suffixClean)) {
          results.push({ label: `\`${prefixClean}\`.\`${t.name}\``, kind: 'table' });
        }
      }
      return results;
    }

    // Check if prefix is a table name — suggest columns
    for (const [, tables] of Object.entries(schemaMap)) {
      const table = tables.find((t) => t.name === prefixClean);
      if (table) {
        for (const col of table.columns) {
          if (col.name.toLowerCase().startsWith(suffixClean)) {
            results.push({ label: col.name, kind: 'column', sub: `${col.type}` });
          }
        }
        return results;
      }
    }
    return results;
  }

  // Keyword match
  for (const kw of SQL_COMPLETIONS) {
    if (kw.label.toLowerCase().startsWith(lower)) {
      results.push({ label: kw.label, kind: 'keyword' });
    }
  }

  // Table match from selected databases
  for (const db of selectedDbs) {
    const tables = schemaMap[db];
    if (!tables) continue;
    for (const t of tables) {
      if (t.name.toLowerCase().startsWith(lower)) {
        results.push({ label: t.name, kind: 'table', sub: db });
      }
    }
  }

  // Also check tables from current database (first selected or connection default)
  const primaryDb = currentDb || selectedDbs[0];
  if (primaryDb) {
    const tables = schemaMap[primaryDb];
    if (tables) {
      for (const t of tables) {
        if (t.name.toLowerCase().startsWith(lower) && !results.some((r) => r.label === t.name)) {
          results.push({ label: t.name, kind: 'table', sub: primaryDb });
        }
      }
    }
  }

  return results.slice(0, 30);
}

/* ---------- Component ---------- */
export function SqlEditor({
  value,
  onChange,
  schemaMap,
  selectedDbs,
  currentDb,
}: {
  value: string;
  onChange: (value: string) => void;
  schemaMap: Record<string, TableSchema[]>;
  selectedDbs: string[];
  currentDb?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [completionIdx, setCompletionIdx] = useState(0);
  const [cursorPos, setCursorPos] = useState(0);
  const isComposing = useRef(false);

  const tokens = useMemo(() => tokenize(value), [value]);
  const highlightedHtml = useMemo(() => tokensToHtml(tokens), [tokens]);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && backdropRef.current) {
      backdropRef.current.scrollTop = textareaRef.current.scrollTop;
      backdropRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const openCompletions = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    const pos = el.selectionStart;
    setCursorPos(pos);
    const wordInfo = getCurrentWord(value, pos);
    if (!wordInfo || wordInfo.word.length === 0) {
      setCompletions([]);
      return;
    }
    const items = filterCompletions(wordInfo.word, schemaMap, selectedDbs, currentDb);
    setCompletions(items);
    setCompletionIdx(0);
  }, [value, schemaMap, selectedDbs, currentDb]);

  const closeCompletions = useCallback(() => {
    setCompletions([]);
  }, []);

  const applyCompletion = useCallback(
    (completion: Completion) => {
      const el = textareaRef.current;
      if (!el) return;
      const pos = el.selectionStart;
      const wordInfo = getCurrentWord(value, pos);
      if (!wordInfo) return;
      const before = value.slice(0, wordInfo.start);
      const after = value.slice(wordInfo.end);

      let insert = completion.label;
      // uppercase keywords
      if (completion.kind === 'keyword') insert = completion.label.toUpperCase();

      // Add space after keywords that need it
      const needsSpace = /^(SELECT|FROM|WHERE|AND|OR|SET|ON|AS|IN|IS|BY|JOIN|INTO|VALUES|LIMIT|DESC|ASC|ALL|END)$/i.test(insert);
      if (needsSpace) insert += ' ';

      const newValue = before + insert + after;
      onChange(newValue);

      // Place cursor after insertion
      setTimeout(() => {
        if (textareaRef.current) {
          const newPos = before.length + insert.length;
          textareaRef.current.selectionStart = newPos;
          textareaRef.current.selectionEnd = newPos;
        }
      }, 0);

      closeCompletions();
    },
    [value, onChange, closeCompletions]
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (completions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setCompletionIdx((prev) => Math.min(prev + 1, completions.length - 1));
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setCompletionIdx((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          event.preventDefault();
          applyCompletion(completions[completionIdx]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeCompletions();
          return;
        }
      }
      // Re-trigger autocomplete on specific keys
      if (event.key === '.' || event.key === '`') {
        setTimeout(() => openCompletions(), 0);
      }
    },
    [completions, completionIdx, applyCompletion, closeCompletions, openCompletions]
  );

  // Calculate dropdown position relative to cursor
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    if (completions.length === 0) return;
    const el = textareaRef.current;
    if (!el) return;

    // Approximate cursor position using a mirror technique
    const beforeText = value.slice(0, cursorPos);
    const lines = beforeText.split('\n');
    const currentLine = lines.length;
    const currentCol = lines[lines.length - 1].length;

    const lineHeight = 19; // approximate
    const charWidth = 7.8; // approximate mono
    const paddingTop = 14;
    const paddingLeft = 16;

    // Clamp position to stay within editor
    const top = Math.min(currentLine * lineHeight + paddingTop, (textareaRef.current?.clientHeight || 200) - 160);
    const left = Math.min(currentCol * charWidth + paddingLeft, (textareaRef.current?.clientWidth || 400) - 260);

    setDropdownStyle({ top: `${top}px`, left: `${left}px` });
  }, [completions, cursorPos, value]);

  return (
    <div className="sql-editor-wrap">
      <div className="sql-editor-backdrop" ref={backdropRef} aria-hidden="true">
        <pre><code dangerouslySetInnerHTML={{ __html: highlightedHtml + '\n' }} /></pre>
      </div>
      <textarea
        ref={textareaRef}
        className="sql-editor-textarea"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          if (!isComposing.current) {
            setTimeout(() => openCompletions(), 0);
          }
        }}
        onCompositionStart={() => { isComposing.current = true; }}
        onCompositionEnd={() => {
          isComposing.current = false;
          setTimeout(() => openCompletions(), 0);
        }}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        onClick={() => {
          syncScroll();
          setTimeout(() => openCompletions(), 0);
        }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
      />

      {completions.length > 0 && (
        <div className="sql-autocomplete" style={dropdownStyle}>
          {completions.map((item, idx) => (
            <button
              key={`${item.label}-${idx}`}
              className={`sql-ac-item ${idx === completionIdx ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyCompletion(item)}
            >
              <span className={`sql-ac-label sql-ac-${item.kind}`}>{item.label}</span>
              {item.sub && <span className="sql-ac-sub">{item.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
