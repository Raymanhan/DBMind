import { useState, useEffect, useCallback } from 'react';
import type { DatabaseInfo, DbConnectionConfig, DbmindApi } from '../../shared/types';

export function useConnections({
  api, emptyConnection, driverLabel, setNotice, setLoadingFlag
}: {
  api: DbmindApi;
  emptyConnection: DbConnectionConfig;
  driverLabel: (d: string) => string;
  setNotice: (msg: string) => void;
  setLoadingFlag: (k: 'connection', v: boolean) => void;
}) {
  const [connections, setConnections] = useState<DbConnectionConfig[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState('');
  const [connectionDraft, setConnectionDraft] = useState<DbConnectionConfig>(emptyConnection);
  const [showConnectionModal, setShowConnectionModal] = useState(false);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);

  useEffect(() => {
    api.getConnections().then((items) => {
      setConnections(items);
      if (!activeConnectionId) setActiveConnectionId(items[0]?.id ?? '');
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveConnection = useCallback(async () => {
    setLoadingFlag('connection', true);
    try {
      const id = connectionDraft.id || crypto.randomUUID();
      let draft: DbConnectionConfig = { ...connectionDraft, id, port: Number(connectionDraft.port), connectTimeout: Number(connectionDraft.connectTimeout) };
      if (!draft.name) draft = { ...draft, name: `${driverLabel(draft.driver)} · ${draft.host || 'localhost'}:${draft.port || 3306}` };
      if (draft.driver === 'mysql' && !draft.database) {
        const items = databases.length ? databases : await api.listDatabases(draft);
        const firstUserDb = items.find((d) => !d.system) ?? items[0];
        if (firstUserDb) { draft = { ...draft, database: firstUserDb.name }; setDatabases(items); }
      }
      const next = await api.saveConnection(draft);
      setConnections(next);
      setConnectionDraft(draft);
      setActiveConnectionId(id);
      setShowConnectionModal(false);
      setNotice(draft.database ? `连接已保存：${draft.database}` : '连接已保存，请选择数据库');
    } catch (e) { setNotice(e instanceof Error ? e.message : '连接保存失败'); } finally { setLoadingFlag('connection', false); }
  }, [connectionDraft, databases, api, driverLabel, setNotice, setLoadingFlag]);

  const deleteConnection = useCallback(async (id: string) => {
    const next = await api.deleteConnection(id);
    setConnections(next);
    setActiveConnectionId(next[0]?.id ?? '');
    setConnectionDraft(emptyConnection);
    setNotice('连接已删除');
  }, [api, emptyConnection, setNotice]);

  const editConnection = useCallback((c: DbConnectionConfig) => {
    setConnectionDraft({ ...emptyConnection, ...c });
    setShowConnectionModal(true);
    setNotice(`正在编辑连接：${c.name}`);
  }, [emptyConnection, setNotice]);

  const testConnection = useCallback(async () => {
    setLoadingFlag('connection', true);
    try {
      const draft = { ...connectionDraft, port: Number(connectionDraft.port), connectTimeout: Number(connectionDraft.connectTimeout) };
      const res = await api.testConnection(draft);
      setNotice(res.message);
      if (res.ok) {
        const items = await api.listDatabases(draft);
        setDatabases(items);
        if (!draft.database) {
          const firstUserDb = items.find((d) => !d.system) ?? items[0];
          if (firstUserDb) setConnectionDraft({ ...draft, database: firstUserDb.name });
        }
      }
    } catch (e) { setNotice(e instanceof Error ? e.message : '连接测试失败'); } finally { setLoadingFlag('connection', false); }
  }, [connectionDraft, api, setNotice, setLoadingFlag]);

  const startNewConnection = useCallback(() => {
    setConnectionDraft(emptyConnection);
    setShowConnectionModal(true);
  }, [emptyConnection]);

  const listDatabases = useCallback(async (config: DbConnectionConfig) => {
    try { return await api.listDatabases(config); } catch { return []; }
  }, [api]);

  return {
    connections, setConnections,
    activeConnectionId, setActiveConnectionId,
    connectionDraft, setConnectionDraft,
    showConnectionModal, setShowConnectionModal,
    databases, setDatabases,
    saveConnection, deleteConnection, editConnection, testConnection, startNewConnection, listDatabases
  };
}
