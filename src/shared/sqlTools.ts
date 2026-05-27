import type { TableSchema, ColumnMeta } from './api/types.js';

const destructiveWithoutWhere = /\b(delete|update)\b(?![\s\S]*\bwhere\b)/i;
const destructiveDdl = /\b(drop|truncate|alter)\b/i;

export function extractTableMentions(text: string): Array<{ database: string; table: string; raw: string }> {
  const matches = [...text.matchAll(/@([\w-]+)\.([\w]+)/g)];
  return [...new Map(matches.map((m) => [m[1] + '.' + m[2], { database: m[1], table: m[2], raw: m[0] }])).values()];
}

export function tableRef(table: TableSchema, dialect: string): string {
  const quote =
    dialect === 'postgres'
      ? (identifier: string) => `"${identifier.replace(/"/g, '""')}"`
      : (identifier: string) => `\`${identifier.replace(/`/g, '``')}\``;
  return table.schema ? `${quote(table.schema)}.${quote(table.table)}` : quote(table.table);
}

export function removeTableMentions(text: string): string {
  return text
    .replace(/@[\w-]+\.[\w]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSchemaPrompt(tables: TableSchema[], dialect = 'mysql'): string {
  return tables
    .map((table) => {
      const tableLabel =
        table.schema
          ? dialect === 'postgres'
            ? `"${table.schema}"."${table.table}"`
            : `\`${table.schema}\`.\`${table.table}\``
          : dialect === 'postgres'
            ? `"${table.table}"`
            : `\`${table.table}\``;
      const columns = table.columns
        .map((column: ColumnMeta) => {
          const flags =
            [
              column.is_primary_key ? 'PK' : '',
              !column.nullable ? 'NOT NULL' : '',
            ]
              .filter(Boolean)
              .join(', ');
          return `  - ${column.name} ${column.data_type}${flags ? ` (${flags})` : ''}`;
        })
        .join('\n');
      return `Table ${tableLabel}${table.row_count ? ` (~${table.row_count} rows)` : ''}\n${columns}`;
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

export function addLimitIfSelect(sql: string, limit = 100): string {
  if (!/^\s*select\b/i.test(sql) || /\blimit\s+\d+/i.test(sql)) return sql;
  return `${sql.replace(/;+\s*$/, '')}\nLIMIT ${limit};`;
}
