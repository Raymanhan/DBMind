export interface SqlStatement {
  sql: string;
  startLine: number;
}

export function splitSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let start = 0;
  let startLine = 1;
  let line = 1;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let previous = '';

  const pushStatement = (end: number) => {
    const raw = sql.slice(start, end);
    const leadingWhitespace = raw.match(/^\s*/)?.[0] ?? '';
    const skippedLines = (leadingWhitespace.match(/\n/g) ?? []).length;
    const text = raw.trim();
    if (text) {
      statements.push({ sql: text, startLine: startLine + skippedLines });
    }
  };

  for (let index = 0; index < sql.length; index++) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === '\n') line += 1;

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
    } else if (inBlockComment) {
      if (previous === '*' && char === '/') inBlockComment = false;
    } else if (inSingle) {
      if (char === "'" && previous !== '\\') inSingle = false;
    } else if (inDouble) {
      if (char === '"' && previous !== '\\') inDouble = false;
    } else if (char === '-' && next === '-') {
      inLineComment = true;
    } else if (char === '/' && next === '*') {
      inBlockComment = true;
    } else if (char === "'") {
      inSingle = true;
    } else if (char === '"') {
      inDouble = true;
    } else if (char === ';') {
      pushStatement(index);
      start = index + 1;
      startLine = line;
    }

    previous = char;
  }

  pushStatement(sql.length);
  return statements;
}

export function firstSqlVerb(sql: string): string {
  return sql.trim().split(/\s+/)[0]?.toUpperCase() || 'SQL';
}

export function statementLabel(sql: string, index: number, total: number): string {
  const firstLine = sql.trim().split('\n')[0]?.trim() ?? '';
  const shortLine = firstLine.length > 28 ? `${firstLine.slice(0, 28)}...` : firstLine;
  const prefix = total > 1 ? `${index + 1}. ` : '';
  return `${prefix}${shortLine || firstSqlVerb(sql)}`;
}
