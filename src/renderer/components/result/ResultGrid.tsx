import {memo, useCallback, type CSSProperties, type MouseEvent} from 'react';
import {useTranslation} from 'react-i18next';
import type {ColumnSchema, WorkTab} from '../../../shared/types';
import {EditableCell, type InlineCellEditorState} from './EditableCell';
import {
  RESULT_GRID_HEADER_HEIGHT,
  RESULT_GRID_INDEX_WIDTH,
  RESULT_GRID_ROW_HEIGHT,
  type GridCellPosition,
  type GridSelection,
  type VirtualColumn,
  type VirtualRow,
  normalizeSelection,
  useResultGridColumnSizing,
  useResultGridDragScroll,
  useResultGridSelection,
  useResultGridViewport,
  useVirtualResultGrid
} from './useResultGridEngine';

type PendingCellEdit = {
  newValue: string;
  asNull: boolean;
};

interface ResultGridProps {
  columns: string[];
  rows: Record<string, unknown>[];
  sort?: WorkTab['sort'];
  pendingEditsMap: Map<string, PendingCellEdit>;
  columnSchemaMap: Map<string, ColumnSchema>;
  editorState: InlineCellEditorState | null;
  getCellEditBlockReason: (row: Record<string, unknown>, column: string) => string | null;
  formatValue: (value: unknown) => string;
  onSortColumn: (column: string) => void;
  onBeginEdit: (rowIndex: number, row: Record<string, unknown>, column: string) => void;
  onEditorChange: (next: InlineCellEditorState) => void;
  onCommit: (next: InlineCellEditorState) => void;
  onCancel: () => void;
  onCopyCell: (value: unknown) => void;
}

type ResultGridRowProps = Pick<
  ResultGridProps,
  'columnSchemaMap' | 'editorState' | 'formatValue' | 'getCellEditBlockReason' | 'onBeginEdit' | 'onCancel' | 'onCommit' | 'onCopyCell' | 'onEditorChange' | 'pendingEditsMap'
> & {
  row: Record<string, unknown>;
  virtualRow: VirtualRow;
  virtualColumns: VirtualColumn[];
  isCellActive: (rowIndex: number, columnIndex: number) => boolean;
  isCellSelected: (rowIndex: number, columnIndex: number) => boolean;
};

const ResultGridRow = memo(function ResultGridRow({
  row,
  virtualRow,
  virtualColumns,
  isCellActive,
  isCellSelected,
  pendingEditsMap,
  columnSchemaMap,
  editorState,
  getCellEditBlockReason,
  formatValue,
  onBeginEdit,
  onEditorChange,
  onCommit,
  onCancel,
  onCopyCell
}: ResultGridRowProps) {
  const rowIndex = virtualRow.index;

  return (
    <div
      className={`result-grid-row result-grid-data-row ${rowIndex % 2 === 1 ? 'result-grid-row-even' : ''}`}
      role="row"
      style={{transform: `translateY(${virtualRow.offsetTop}px)`}}
    >
      <div className="result-grid-cell result-grid-index-cell" role="rowheader">{rowIndex + 1}</div>
      {virtualColumns.map((virtualColumn) => {
        const column = virtualColumn.name;
        const pendingKey = `${rowIndex}:${column}`;
        const pendingEdit = pendingEditsMap.get(pendingKey);
        const displayValue = pendingEdit
          ? (pendingEdit.asNull ? 'NULL' : pendingEdit.newValue)
          : formatValue(row[column]);

        return (
          <EditableCell
            as="div"
            key={column}
            id={`result-cell-${rowIndex}-${virtualColumn.index}`}
            rowIndex={rowIndex}
            columnIndex={virtualColumn.index}
            column={column}
            value={row[column]}
            reason={getCellEditBlockReason(row, column)}
            columnSchema={columnSchemaMap.get(column)}
            pendingEdit={pendingEdit}
            editorState={editorState}
            displayValue={displayValue}
            isNullDisplay={Boolean(pendingEdit?.asNull)}
            onBeginEdit={() => onBeginEdit(rowIndex, row, column)}
            onEditorChange={onEditorChange}
            onCommit={onCommit}
            onCancel={onCancel}
            onCopy={() => onCopyCell(row[column])}
            className={[
              isCellSelected(rowIndex, virtualColumn.index) ? 'cell-selected' : '',
              isCellActive(rowIndex, virtualColumn.index) ? 'cell-active' : ''
            ].filter(Boolean).join(' ')}
            style={{
              width: virtualColumn.width,
              height: RESULT_GRID_ROW_HEIGHT,
              transform: `translateX(${virtualColumn.offsetLeft}px)`
            }}
          />
        );
      })}
    </div>
  );
});

export function ResultGrid({
  columns,
  rows,
  sort,
  pendingEditsMap,
  columnSchemaMap,
  editorState,
  getCellEditBlockReason,
  formatValue,
  onSortColumn,
  onBeginEdit,
  onEditorChange,
  onCommit,
  onCancel,
  onCopyCell
}: ResultGridProps) {
  const { t } = useTranslation();
  const {viewport, viewportRef, setViewportRef, onScroll} = useResultGridViewport();
  const {isDragging, onMouseDown} = useResultGridDragScroll(viewportRef);
  const {columnWidths, startColumnResize} = useResultGridColumnSizing(columns);
  const virtualGrid = useVirtualResultGrid(columns, rows.length, viewport, columnWidths);

  const beginEditAt = useCallback((position: GridCellPosition) => {
    const row = rows[position.rowIndex];
    const column = columns[position.columnIndex];
    if (row && column) onBeginEdit(position.rowIndex, row, column);
  }, [columns, onBeginEdit, rows]);

  const copySelection = useCallback((selection: GridSelection) => {
    const range = normalizeSelection(selection);
    const lines: string[] = [];
    for (let rowIndex = range.minRow; rowIndex <= range.maxRow; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row) continue;
      const values: string[] = [];
      for (let columnIndex = range.minColumn; columnIndex <= range.maxColumn; columnIndex += 1) {
        const column = columns[columnIndex];
        values.push(column ? formatValue(row[column]) : '');
      }
      lines.push(values.join('\t'));
    }
    const text = lines.join('\n');
    if (text) void navigator.clipboard?.writeText(text).catch(() => undefined);
  }, [columns, formatValue, rows]);

  const {selection, isCellActive, isCellSelected, onKeyDown, selectCell} = useResultGridSelection({
    columns,
    rowCount: rows.length,
    viewportRef,
    columnOffsets: virtualGrid.columnOffsets,
    columnWidths: virtualGrid.columnWidths,
    onBeginEdit: beginEditAt,
    onCopySelection: copySelection
  });

  const handleDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const cell = (event.target as HTMLElement).closest('[data-cell]');
    if (!cell) return;
    const rowIndex = Number(cell.getAttribute('data-row-index'));
    const column = cell.getAttribute('data-column');
    if (Number.isNaN(rowIndex) || !column) return;
    const row = rows[rowIndex];
    if (row) onBeginEdit(rowIndex, row, column);
  }, [onBeginEdit, rows]);

  const handleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    viewportRef.current?.focus();
    const cell = (event.target as HTMLElement).closest('[data-cell]');
    if (!cell) return;
    const rowIndex = Number(cell.getAttribute('data-row-index'));
    const columnIndex = Number(cell.getAttribute('data-column-index'));
    if (Number.isNaN(rowIndex) || Number.isNaN(columnIndex)) return;
    selectCell({rowIndex, columnIndex}, event.shiftKey);
  }, [selectCell]);

  return (
    <div
      className="result-grid"
      ref={setViewportRef}
      onScroll={onScroll}
      onMouseDown={onMouseDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={onKeyDown}
      role="grid"
      tabIndex={0}
      aria-rowcount={rows.length}
      aria-colcount={columns.length + 1}
      aria-activedescendant={selection ? `result-cell-${selection.focus.rowIndex}-${selection.focus.columnIndex}` : undefined}
      data-dragging={isDragging ? 'true' : undefined}
      style={{
        '--result-grid-total-width': `${virtualGrid.totalWidth}px`,
        '--result-grid-index-width': `${RESULT_GRID_INDEX_WIDTH}px`,
        '--result-grid-header-height': `${RESULT_GRID_HEADER_HEIGHT}px`
      } as CSSProperties}
    >
      <div className="result-grid-header" role="row" style={{width: virtualGrid.totalWidth}}>
        <div className="result-grid-head result-grid-index-head" role="columnheader">#</div>
        {virtualGrid.columns.map((virtualColumn) => (
          <div
            className="result-grid-head result-grid-column-head"
            role="columnheader"
            key={virtualColumn.name}
            style={{
              width: virtualColumn.width,
              height: RESULT_GRID_HEADER_HEIGHT,
              transform: `translateX(${virtualColumn.offsetLeft}px)`
            }}
          >
            <button
              className={`column-sort ${sort?.column === virtualColumn.name ? 'active' : ''}`}
              onClick={() => onSortColumn(virtualColumn.name)}
            >
              <span>{virtualColumn.name}</span>
              <em>{sort?.column === virtualColumn.name ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</em>
            </button>
            <span
              className="column-resize-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label={t('result.resizeColumn', { column: virtualColumn.name })}
              onMouseDown={(event) => startColumnResize(event, virtualColumn.name)}
            />
          </div>
        ))}
      </div>

      <div className="result-grid-body" style={{width: virtualGrid.totalWidth, height: virtualGrid.totalHeight}}>
        {virtualGrid.rows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <ResultGridRow
              key={virtualRow.index}
              row={row}
              virtualRow={virtualRow}
              virtualColumns={virtualGrid.columns}
              isCellActive={isCellActive}
              isCellSelected={isCellSelected}
              pendingEditsMap={pendingEditsMap}
              columnSchemaMap={columnSchemaMap}
              editorState={editorState}
              getCellEditBlockReason={getCellEditBlockReason}
              formatValue={formatValue}
              onBeginEdit={onBeginEdit}
              onEditorChange={onEditorChange}
              onCommit={onCommit}
              onCancel={onCancel}
              onCopyCell={onCopyCell}
            />
          );
        })}
      </div>
    </div>
  );
}
