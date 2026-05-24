import type { ColumnSchema, TableSchema } from './types.js';

const destructiveWithoutWhere = /\b(delete|update)\b(?![\s\S]*\bwhere\b)/i;
const destructiveDdl = /\b(drop|truncate|alter)\b/i;

export function extractTableMentions(text: string): string[] {
  const matches = [...text.matchAll(/@([a-zA-Z_][\w.]*)(?![\w])/g)];
  return [...new Set(matches.map((match) => match[1]))];
}

export function removeTableMentions(text: string): string {
  return text.replace(/@([a-zA-Z_][\w.]*)(?![\w])/g, '').replace(/\s+/g, ' ').trim();
}

export function buildSchemaPrompt(tables: TableSchema[]): string {
  return tables
    .map((table) => {
      const columns = table.columns
        .map((column: ColumnSchema) => {
          const flags = [column.primary ? 'PK' : '', column.nullable === false ? 'NOT NULL' : '', column.references ? `FK ${column.references}` : '']
            .filter(Boolean)
            .join(', ');
          return `  - ${column.name} ${column.type}${flags ? ` (${flags})` : ''}`;
        })
        .join('\n');
      return `Table ${table.name}${table.rowCount ? ` (~${table.rowCount} rows)` : ''}\n${columns}`;
    })
    .join('\n\n');
}

export function validateSql(sql: string): string[] {
  const warnings: string[] = [];
  if (destructiveDdl.test(sql)) {
    warnings.push('包含 DROP / TRUNCATE / ALTER 等高风险 DDL，执行前必须二次确认。');
  }
  if (destructiveWithoutWhere.test(sql)) {
    warnings.push('DELETE / UPDATE 未检测到 WHERE 条件，可能影响全表。');
  }
  if (!/\blimit\s+\d+/i.test(sql) && /^\s*select\b/i.test(sql)) {
    warnings.push('SELECT 未包含 LIMIT，生产库建议限制返回行数。');
  }
  return warnings;
}

export function addLimitIfSelect(sql: string, limit = 1000): string {
  if (!/^\s*select\b/i.test(sql) || /\blimit\s+\d+/i.test(sql)) return sql;
  return `${sql.replace(/;+\s*$/, '')}\nLIMIT ${limit};`;
}

export function localSqlFromPrompt(prompt: string, tables: TableSchema[], dialect = 'mysql'): string {
  const tableNames = tables.map((table) => table.name);
  const cleanPrompt = removeTableMentions(prompt);
  const first = tables[0];
  const second = tables[1];
  const dateColumn = first?.columns.find((column: ColumnSchema) => /created|date|time/i.test(column.name))?.name ?? 'created_at';
  const amountColumn =
    first?.columns.find((column: ColumnSchema) => /amount|total|price|revenue|sales/i.test(column.name))?.name ??
    second?.columns.find((column: ColumnSchema) => /amount|total|price|revenue|sales|unit_price/i.test(column.name))?.name;

  if (first && second && /销售额|收入|revenue|sales/i.test(cleanPrompt)) {
    const quantity = second.columns.find((column: ColumnSchema) => /qty|quantity|count/i.test(column.name))?.name ?? 'quantity';
    const price = second.columns.find((column: ColumnSchema) => /price|amount|total/i.test(column.name))?.name ?? amountColumn ?? 'unit_price';
    const fk = second.columns.find((column: ColumnSchema) => column.references?.includes(first.name) || /order_id|_id$/i.test(column.name))?.name ?? `${first.name.replace(/s$/, '')}_id`;
    const pk = first.columns.find((column: ColumnSchema) => column.primary)?.name ?? 'id';
    const dayExpr =
      dialect === 'postgres'
        ? `DATE_TRUNC('day', t1.${dateColumn})::date`
        : `DATE_FORMAT(t1.${dateColumn}, '%Y-%m-%d')`;
    const sevenDays =
      dialect === 'postgres'
        ? "NOW() - INTERVAL '7 days'"
        : 'DATE_SUB(NOW(), INTERVAL 7 DAY)';
    return addLimitIfSelect(`SELECT
  ${dayExpr} AS date,
  SUM(t2.${quantity} * t2.${price}) AS revenue
FROM ${first.name} t1
JOIN ${second.name} t2 ON t1.${pk} = t2.${fk}
WHERE t1.${dateColumn} >= ${sevenDays}
GROUP BY date
ORDER BY date ASC;`);
  }

  if (first && /统计|数量|count|多少/i.test(cleanPrompt)) {
    return `SELECT COUNT(*) AS total_count\nFROM ${first.name};`;
  }

  if (first) {
    const columns = first.columns.slice(0, 8).map((column: ColumnSchema) => column.name).join(', ');
    return `SELECT ${columns || '*'}\nFROM ${first.name}\nLIMIT 100;`;
  }

  return `SELECT *\nFROM ${tableNames[0] ?? 'your_table'}\nLIMIT 100;`;
}
