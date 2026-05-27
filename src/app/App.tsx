import { AppLayout } from '../layouts/AppLayout';
import { useUiStore } from '../shared/stores/uiStore';
import { useCallback, useEffect } from 'react';
import { useTauriEvents } from '../shared/hooks/useTauriEvents';
import { useQueryStore } from '../shared/stores/queryStore';
import type { ColumnMeta } from '../shared/api/types';

export default function App() {
  const theme = useUiStore((s) => s.theme);
  const updateResult = useQueryStore((s) => s.updateResult);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useTauriEvents({
    onQueryReady: useCallback(
      ({
        query_id,
        columns,
        row_count,
        execution_time_ms,
        affected_rows,
      }: {
        query_id: string;
        columns: ColumnMeta[];
        row_count?: number;
        execution_time_ms: number;
        affected_rows?: number;
      }) => {
        updateResult(query_id, {
          status: 'ready',
          columns,
          row_count,
          execution_time_ms,
          affected_rows,
        });
      },
      [updateResult],
    ),
    onQueryError: useCallback(
      ({ query_id, error }: { query_id: string; error: string }) => {
        updateResult(query_id, { status: 'error', error });
      },
      [updateResult],
    ),
    onQueryCancelled: useCallback(
      ({ query_id }: { query_id: string }) => {
        updateResult(query_id, { status: 'cancelled' });
      },
      [updateResult],
    ),
  });

  return <AppLayout />;
}
