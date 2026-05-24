import { useCallback, useMemo, useState } from 'react';
import type { BatchCellEditEntry, BatchUpdateCellRequest, DbmindApi, TableSchema } from '../../shared/types';
import type { BatchCellEdit } from '../components/result/BatchEditToolbar';
import type { SqlConfirmData } from '../components/modals/SqlConfirmModal';

export function useBatchEdit({
  api,
  activeConnectionId,
  activeResult,
  dbName,
  tableName,
  tableSchema,
  setLoadingFlag,
  setNotice,
  onRefreshResult,
  getCellEditBlockReason
}: {
  api: DbmindApi;
  activeConnectionId: string;
  activeResult: { rows: Record<string, unknown>[] } | null;
  dbName?: string;
  tableName?: string;
  tableSchema?: TableSchema;
  setLoadingFlag: (key: string, value: boolean) => void;
  setNotice: (msg: string) => void;
  onRefreshResult: () => void;
  getCellEditBlockReason: (row: Record<string, unknown>, column: string) => string | null;
}) {
  const [activeInlineEditor, setActiveInlineEditor] = useState<{
    rowIndex: number; column: string; value: string; asNull: boolean;
  } | null>(null);
  const [pendingEdits, setPendingEdits] = useState<BatchCellEdit[]>([]);
  const [pendingSqlConfirm, setPendingSqlConfirm] = useState<SqlConfirmData | null>(null);

  const pendingEditsMap = useMemo(() => {
    const map = new Map<string, BatchCellEdit>();
    for (const edit of pendingEdits) {
      map.set(`${edit.rowIndex}:${edit.column}`, edit);
    }
    return map;
  }, [pendingEdits]);

  const beginCellEdit = useCallback((rowIndex: number, row: Record<string, unknown>, column: string) => {
    const reason = getCellEditBlockReason(row, column);
    if (reason) { setNotice(reason); return; }
    const existing = pendingEditsMap.get(`${rowIndex}:${column}`);
    const rawValue = existing ? existing.newValue : row[column];
    const asNull = existing ? existing.asNull : rawValue === null || rawValue === undefined;
    setActiveInlineEditor({
      rowIndex, column,
      value: (asNull && !existing) ? '' : (rawValue === null || rawValue === undefined ? '' : String(rawValue)),
      asNull
    });
  }, [getCellEditBlockReason, pendingEditsMap, setNotice]);

  const finishCellEdit = useCallback((editorState: { rowIndex: number; column: string; value: string; asNull: boolean }) => {
    if (!activeResult || !dbName || !tableName || !tableSchema) return;
    const row = activeResult.rows[editorState.rowIndex];
    if (!row) return;
    const rawValue = row[editorState.column];
    const originalValue = rawValue === null || rawValue === undefined ? '' : String(rawValue);
    const newValue = editorState.asNull ? '' : editorState.value;
    setPendingEdits((prev) => {
      const filtered = prev.filter((e) => !(e.rowIndex === editorState.rowIndex && e.column === editorState.column));
      if (editorState.asNull && rawValue === null) return filtered;
      if (!editorState.asNull && newValue === originalValue) return filtered;
      return [...filtered, {
        rowIndex: editorState.rowIndex, column: editorState.column,
        newValue, originalValue, asNull: editorState.asNull
      }];
    });
    setActiveInlineEditor(null);
  }, [activeResult, dbName, tableName, tableSchema]);

  const undoEdit = useCallback((rowIndex: number, column: string) => {
    setPendingEdits((prev) => prev.filter((e) => !(e.rowIndex === rowIndex && e.column === column)));
  }, []);

  const undoAllEdits = useCallback(() => setPendingEdits([]), []);

  const saveBatchEdits = useCallback(async () => {
    if (!pendingEdits.length || !activeResult || !dbName || !tableName || !tableSchema) return;
    const edits: BatchCellEditEntry[] = [];
    for (const edit of pendingEdits) {
      const row = activeResult.rows[edit.rowIndex];
      if (!row) continue;
      const primaryKey = Object.fromEntries(
        tableSchema.columns.filter((c) => c.primary).map((c) => [c.name, row[c.name]])
      );
      edits.push({ column: edit.column, primaryKey, value: edit.asNull ? null : edit.newValue });
    }
    const request: BatchUpdateCellRequest = { connectionId: activeConnectionId, database: dbName, table: tableName, edits };
    try {
      const preview = await api.updateCellsBatch(request);
      setPendingSqlConfirm({
        title: `批量更新确认 · ${edits.length} 处修改`,
        sql: preview.sqls.join('\n'),
        onConfirm: async () => {
          setLoadingFlag('query', true);
          try {
            await api.updateCellsBatch({ ...request, execute: true });
            setPendingSqlConfirm(null);
            setPendingEdits([]);
            onRefreshResult();
            setNotice('批量更新完成');
          } catch (error) {
            setNotice(error instanceof Error ? error.message : '批量更新失败');
          } finally {
            setLoadingFlag('query', false);
          }
        }
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '生成批量更新 SQL 失败');
    }
  }, [pendingEdits, activeResult, dbName, tableName, tableSchema, activeConnectionId, api, setLoadingFlag, setNotice, onRefreshResult]);

  return {
    activeInlineEditor, setActiveInlineEditor,
    pendingEdits, setPendingEdits,
    pendingEditsMap,
    pendingSqlConfirm, setPendingSqlConfirm,
    getCellEditBlockReason,
    beginCellEdit, finishCellEdit,
    undoEdit, undoAllEdits,
    saveBatchEdits
  };
}
