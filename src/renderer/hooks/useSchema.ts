import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings, DatabaseInfo, DbmindApi, TableSchema } from '../../shared/types';

function parseTableKey(key: string): { db?: string; table: string } {
  const dot = key.indexOf('.');
  if (dot <= 0) return { table: key };
  return { db: key.slice(0, dot), table: key.slice(dot + 1) };
}

export function useSchema({
  api, activeConnection, activeConnectionId, settings, setSettings, settingsLoaded, setNotice
}: {
  api: DbmindApi;
  activeConnection?: { driver: string; database?: string };
  activeConnectionId: string;
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  settingsLoaded: boolean;
  setNotice: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [schemaMap, setSchemaMap] = useState<Record<string, TableSchema[]>>({});
  const [selectedDbs, setSelectedDbs] = useState<string[]>([]);
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [dbFilter, setDbFilter] = useState('');
  const [selectedTable, setSelectedTable] = useState('');
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [showDbSelector, setShowDbSelector] = useState(false);

  const saveSelectedDbs = useCallback(async (connId: string, dbs: string[]) => {
    const next = await api.saveSettings({
      ...settings,
      selectedDatabasesByConnection: { ...(settings.selectedDatabasesByConnection ?? {}), [connId]: dbs }
    });
    setSettings(next);
  }, [api, settings, setSettings]);

  const toggleDb = useCallback((dbName: string) => {
    if (!activeConnectionId) return;
    setSelectedDbs((prev) => {
      if (prev.includes(dbName)) {
        const next = prev.filter((d) => d !== dbName);
        saveSelectedDbs(activeConnectionId, next).catch(() => setNotice(t('notice.dbSelectFailed')));
        return next;
      }
      const next = [...prev, dbName];
      saveSelectedDbs(activeConnectionId, next).catch(() => setNotice(t('notice.dbSelectFailed')));
      return next;
    });
  }, [activeConnectionId, saveSelectedDbs, setNotice, t]);

  const toggleExpandDb = useCallback((dbName: string) => {
    setExpandedDbs((prev) => { const next = new Set(prev); if (next.has(dbName)) next.delete(dbName); else next.add(dbName); return next; });
  }, []);

  const refreshDbSchema = useCallback(async (dbName: string) => {
    if (!activeConnectionId) return;
    try {
      const items = await api.getSchema(activeConnectionId, dbName);
      setSchemaMap((prev) => ({ ...prev, [dbName]: items }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('notice.schemaRefreshFailed', { db: dbName }));
    }
  }, [api, activeConnectionId, setNotice, t]);

  const refreshAllSchemas = useCallback(async () => {
    for (const db of selectedDbs) await refreshDbSchema(db);
  }, [selectedDbs, refreshDbSchema]);

  // Fetch schema for newly selected databases
  useEffect(() => {
    for (const db of selectedDbs) {
      if (!schemaMap[db]) refreshDbSchema(db);
    }
  }, [selectedDbs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset on connection switch
  useEffect(() => {
    if (!settingsLoaded) return;
    const selectedByConnection = settings.selectedDatabasesByConnection ?? {};
    const saved = activeConnectionId && Object.prototype.hasOwnProperty.call(selectedByConnection, activeConnectionId)
      ? selectedByConnection[activeConnectionId]
      : activeConnection?.database ? [activeConnection.database] : [];
    setSelectedDbs(saved);
    setExpandedDbs(new Set(saved));
    setSchemaMap({});
    setSelectedTable('');
    setSearchQuery('');
    setDbFilter('');
    setShowDbSelector(false);
  }, [activeConnectionId, settingsLoaded, activeConnection?.database]); // eslint-disable-line react-hooks/exhaustive-deps

  // List databases for MySQL connections
  useEffect(() => {
    if (!activeConnection || activeConnection.driver !== 'mysql') { setDatabases([]); return; }
    api.listDatabases(activeConnection as any).then(setDatabases).catch(() => setDatabases([]));
  }, [activeConnectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const allTables = useMemo(() => Object.values(schemaMap).flat(), [schemaMap]);
  const selectedSchema = useMemo(() => {
    if (!selectedTable) return undefined;
    const { db, table } = parseTableKey(selectedTable);
    if (db) {
      const dbKey = Object.keys(schemaMap).find((k) => k.toLowerCase() === db.toLowerCase());
      return dbKey ? schemaMap[dbKey]?.find((t) => t.name.toLowerCase() === table.toLowerCase()) : undefined;
    }
    return allTables.find((t) => t.name.toLowerCase() === table.toLowerCase());
  }, [allTables, schemaMap, selectedTable]);
  const selectedSchemaDb = useMemo(() => {
    if (!selectedTable) return undefined;
    const { db, table } = parseTableKey(selectedTable);
    if (db) return db;
    for (const [dbName, tables] of Object.entries(schemaMap)) {
      if (tables.some((t) => t.name.toLowerCase() === table.toLowerCase())) return dbName;
    }
    return undefined;
  }, [selectedTable, schemaMap]);

  const dbTreeFiltered = useMemo(() => {
    if (!searchQuery) return null;
    const q = searchQuery.toLowerCase();
    return Object.fromEntries(
      Object.entries(schemaMap).map(([db, tables]) => [db, tables.filter((t) => t.name.toLowerCase().includes(q))])
    );
  }, [schemaMap, searchQuery]);

  const filteredDatabases = useMemo(() => {
    const q = dbFilter.trim().toLowerCase();
    if (!q) return databases;
    return databases.filter((d) => d.name.toLowerCase().includes(q));
  }, [databases, dbFilter]);

  return {
    schemaMap, selectedDbs, setSelectedDbs, expandedDbs, searchQuery, dbFilter, selectedTable,
    databases, showDbSelector,
    setSearchQuery, setDbFilter, setSelectedTable, setShowDbSelector,
    toggleDb, toggleExpandDb, refreshDbSchema, refreshAllSchemas,
    allTables, selectedSchema, selectedSchemaDb,
    dbTreeFiltered, filteredDatabases,
    saveSelectedDbs
  };
}
