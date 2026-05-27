import { useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ColumnMeta } from '../api/types';

interface EventCallbacks {
  onQueryStarted?: (data: { query_id: string; connection_id: string; sql: string }) => void;
  onQueryReady?: (data: {
    query_id: string;
    columns: ColumnMeta[];
    row_count?: number;
    execution_time_ms: number;
    affected_rows?: number;
  }) => void;
  onQueryError?: (data: { query_id: string; error: string }) => void;
  onQueryCancelled?: (data: { query_id: string }) => void;
  onSchemaRefreshed?: (data: { database: string; table_count: number }) => void;
  onAiToken?: (data: { token: string }) => void;
}

export function useTauriEvents(callbacks: EventCallbacks) {
  // Store callbacks in a ref so the listener closure always reads the latest
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    const register = async () => {
      const registrations: [string, (payload: unknown) => void][] = [
        ['query:started', (p) => callbacksRef.current.onQueryStarted?.(p as any)],
        ['query:ready', (p) => callbacksRef.current.onQueryReady?.(p as any)],
        ['query:error', (p) => callbacksRef.current.onQueryError?.(p as any)],
        ['query:cancelled', (p) => callbacksRef.current.onQueryCancelled?.(p as any)],
        ['schema:refreshed', (p) => callbacksRef.current.onSchemaRefreshed?.(p as any)],
        ['ai:token', (p) => callbacksRef.current.onAiToken?.(p as any)],
      ];

      for (const [event, handler] of registrations) {
        if (cancelled) break;
        const un = await listen(event, (event) => handler(event.payload));
        if (cancelled) {
          un();
          break;
        }
        unlisteners.push(un);
      }
    };

    register();

    return () => {
      cancelled = true;
      unlisteners.forEach((un) => un());
    };
  }, []); // mount-only: callbacks are read from ref, not closure
}
