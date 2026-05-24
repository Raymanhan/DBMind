export function quoteMysqlIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

export function mysqlTableRef(table: string, database?: string): string {
  return database ? `${quoteMysqlIdentifier(database)}.${quoteMysqlIdentifier(table)}` : quoteMysqlIdentifier(table);
}
