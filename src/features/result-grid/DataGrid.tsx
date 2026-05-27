import DataEditor, {
  type DataEditorRef,
  type GridCell,
  type GridColumn,
  type GridMouseEventArgs,
  type Item,
  type Theme,
  type Rectangle,
  GridCellKind,
} from '@glideapps/glide-data-grid';
import { useCallback, useMemo, useRef, useEffect } from 'react';
import type { ColumnMeta, CellValue } from '../../shared/api/types';
import { useUiStore } from '../../shared/stores/uiStore';

interface DataGridProps {
  columns: ColumnMeta[];
  queryId: string;
  totalRows?: number;
  fetchBlock: (
    queryId: string,
    rowStart: number,
    rowEnd: number,
    colStart: number,
    colEnd: number,
  ) => Promise<{ rows: CellValue[][] }>;
}

function toGridCell(value: CellValue): GridCell {
  if (value === null || value === undefined) {
    return {
      kind: GridCellKind.Text,
      data: 'NULL',
      displayData: 'NULL',
      allowOverlay: false,
      themeOverride: { textLight: '#5c5f66' },
    };
  }
  if (typeof value === 'boolean') {
    return {
      kind: GridCellKind.Boolean,
      data: value,
      allowOverlay: false,
    };
  }
  if (typeof value === 'number') {
    return {
      kind: GridCellKind.Number,
      data: value,
      displayData: String(value),
      allowOverlay: false,
    };
  }
  if (typeof value === 'string') {
    return {
      kind: GridCellKind.Text,
      data: value,
      displayData: value,
      allowOverlay: true,
    };
  }
  return {
    kind: GridCellKind.Text,
    data: String(value),
    displayData: String(value),
    allowOverlay: false,
  };
}

type CellCache = Map<string, GridCell>;

export function DataGrid({ columns, queryId, totalRows, fetchBlock }: DataGridProps) {
  const theme = useUiStore((s) => s.theme);
  const cellCache = useRef<CellCache>(new Map());
  const gridRef = useRef<DataEditorRef>(null);

  // Clear cache when queryId changes
  useEffect(() => {
    cellCache.current.clear();
  }, [queryId]);

  const gridColumns: GridColumn[] = useMemo(
    () =>
      columns.map((col) => ({
        id: col.name,
        title: col.name,
        width: Math.max(120, Math.min(col.name.length * 10 + 40, 300)),
        hasMenu: false,
      })),
    [columns],
  );

  const cacheKey = (col: number, row: number) => `${col}:${row}`;

  const getCellContent = useCallback(
    ([col, row]: Item): GridCell => {
      const key = cacheKey(col, row);
      const cached = cellCache.current.get(key);
      if (cached) return cached;

      return {
        kind: GridCellKind.Loading,
        allowOverlay: false,
      };
    },
    [],
  );

  const onVisibleRegionChanged = useCallback(
    (range: Rectangle) => {
      const { x: colStart, y: rowStart, width, height } = range;
      const colEnd = colStart + width;
      const rowEnd = rowStart + height;

      fetchBlock(queryId, rowStart, rowEnd, colStart, colEnd)
        .then((block) => {
          const cache = cellCache.current;
          const damaged: { cell: Item }[] = [];
          for (let r = 0; r < block.rows.length; r++) {
            const row = rowStart + r;
            for (let c = 0; c < block.rows[r].length; c++) {
              const col = colStart + c;
              const key = cacheKey(col, row);
              if (!cache.has(key)) {
                cache.set(key, toGridCell(block.rows[r][c]));
                damaged.push({ cell: [col, row] });
              }
            }
          }
          if (damaged.length > 0) {
            gridRef.current?.updateCells(damaged);
          }
        })
        .catch(console.error);
    },
    [queryId, fetchBlock],
  );

  const onCellClicked = useCallback((_cell: Item, _args: GridMouseEventArgs) => {
    // TODO: cell-level editing
  }, []);

  const gridTheme: Partial<Theme> =
    theme === 'dark'
      ? {
          accentColor: '#4c9aff',
          accentLight: 'rgba(76, 154, 255, 0.15)',
          bgCell: '#1a1b1e',
          bgCellMedium: '#25262b',
          bgHeader: '#2c2e33',
          bgHeaderHasFocus: '#373a40',
          bgHeaderHovered: '#373a40',
          textDark: '#c1c2c5',
          textMedium: '#909296',
          textLight: '#5c5f66',
          textHeader: '#c1c2c5',
          borderColor: '#373a40',
          cellHorizontalPadding: 8,
          cellVerticalPadding: 4,
          headerFontStyle: '600 13px',
          baseFontStyle: '13px',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        }
      : {
          accentColor: '#228be6',
          accentLight: 'rgba(34, 139, 230, 0.1)',
          bgCell: '#ffffff',
          bgCellMedium: '#f8f9fa',
          bgHeader: '#f1f3f5',
          bgHeaderHasFocus: '#e9ecef',
          bgHeaderHovered: '#e9ecef',
          textDark: '#212529',
          textMedium: '#495057',
          textLight: '#868e96',
          textHeader: '#212529',
          borderColor: '#dee2e6',
          cellHorizontalPadding: 8,
          cellVerticalPadding: 4,
          headerFontStyle: '600 13px',
          baseFontStyle: '13px',
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
        };

  return (
    <DataEditor
      ref={gridRef}
      columns={gridColumns}
      rows={totalRows ?? 0}
      getCellContent={getCellContent}
      onCellClicked={onCellClicked}
      onVisibleRegionChanged={onVisibleRegionChanged}
      theme={gridTheme}
      width="100%"
      height="100%"
      smoothScrollX
      smoothScrollY
      rowMarkers="number"
      headerHeight={32}
      rowHeight={28}
      keybindings={{ search: true, copy: true }}
    />
  );
}
