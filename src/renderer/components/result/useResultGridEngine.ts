import {useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject} from 'react';

export const RESULT_GRID_ROW_HEIGHT = 41;
export const RESULT_GRID_HEADER_HEIGHT = 39;
export const RESULT_GRID_INDEX_WIDTH = 52;
export const RESULT_GRID_COLUMN_WIDTH = 220;
export const RESULT_GRID_MIN_COLUMN_WIDTH = 96;
export const RESULT_GRID_MAX_COLUMN_WIDTH = 520;

const ROW_OVERSCAN = 8;
const COLUMN_OVERSCAN = 2;
const DRAG_THRESHOLD = 4;

type ViewportState = {
  scrollLeft: number;
  scrollTop: number;
  width: number;
  height: number;
};

type DragState = {
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  currentX: number;
  currentY: number;
  active: boolean;
};

export type VirtualRow = {
  index: number;
  offsetTop: number;
};

export type VirtualColumn = {
  index: number;
  name: string;
  offsetLeft: number;
  width: number;
};

export type VirtualGrid = {
  rows: VirtualRow[];
  columns: VirtualColumn[];
  columnOffsets: number[];
  columnWidths: number[];
  totalWidth: number;
  totalHeight: number;
};

export type GridCellPosition = {
  rowIndex: number;
  columnIndex: number;
};

export type GridSelection = {
  anchor: GridCellPosition;
  focus: GridCellPosition;
};

function readViewport(node: HTMLDivElement): ViewportState {
  return {
    scrollLeft: node.scrollLeft,
    scrollTop: node.scrollTop,
    width: node.clientWidth,
    height: node.clientHeight
  };
}

function sameViewport(a: ViewportState, b: ViewportState): boolean {
  return a.scrollLeft === b.scrollLeft && a.scrollTop === b.scrollTop && a.width === b.width && a.height === b.height;
}

function isDragBlocked(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('button, input, textarea, select, [contenteditable="true"], .cell-editor-shell, .cell-editing, .cell-open-popover, .column-resize-handle'));
}

export function useResultGridViewport() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState<ViewportState>({
    scrollLeft: 0,
    scrollTop: 0,
    width: 0,
    height: 360
  });

  const syncViewport = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      const node = viewportRef.current;
      if (!node) return;
      const next = readViewport(node);
      setViewport((current) => sameViewport(current, next) ? current : next);
    });
  }, []);

  const setViewportRef = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node;
    if (node) setViewport((current) => {
      const next = readViewport(node);
      return sameViewport(current, next) ? current : next;
    });
  }, []);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncViewport);
    observer.observe(node);
    return () => observer.disconnect();
  }, [syncViewport]);

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
  }, []);

  return {
    viewport,
    viewportRef,
    setViewportRef,
    onScroll: syncViewport
  };
}

export function useResultGridDragScroll(viewportRef: RefObject<HTMLDivElement | null>) {
  const dragStateRef = useRef<DragState | null>(null);
  const frameRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const applyDragScroll = () => {
      frameRef.current = null;
      const dragState = dragStateRef.current;
      const node = viewportRef.current;
      if (!dragState || !node) return;

      node.scrollLeft = dragState.startScrollLeft - (dragState.currentX - dragState.startX);
      node.scrollTop = dragState.startScrollTop - (dragState.currentY - dragState.startY);
    };

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState) return;

      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      if (!dragState.active && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD) return;

      if (!dragState.active) {
        dragState.active = true;
        setIsDragging(true);
      }

      dragState.currentX = event.clientX;
      dragState.currentY = event.clientY;
      event.preventDefault();

      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(applyDragScroll);
      }
    };

    const stopDragging = () => {
      dragStateRef.current = null;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('blur', stopDragging);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('blur', stopDragging);
      stopDragging();
    };
  }, [viewportRef]);

  const onMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const node = viewportRef.current;
    if (!node || event.button !== 0 || isDragBlocked(event.target)) return;
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: node.scrollLeft,
      startScrollTop: node.scrollTop,
      currentX: event.clientX,
      currentY: event.clientY,
      active: false
    };
  }, [viewportRef]);

  return {isDragging, onMouseDown};
}

export function useResultGridColumnSizing(columns: string[]) {
  const [columnWidthMap, setColumnWidthMap] = useState<Record<string, number>>({});
  const resizeStateRef = useRef<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const frameRef = useRef<number | null>(null);

  const getColumnWidth = useCallback((column: string) => {
    return columnWidthMap[column] ?? RESULT_GRID_COLUMN_WIDTH;
  }, [columnWidthMap]);

  const columnWidths = useMemo(
    () => columns.map((column) => columnWidthMap[column] ?? RESULT_GRID_COLUMN_WIDTH),
    [columnWidthMap, columns]
  );

  useEffect(() => {
    const applyResize = (clientX: number) => {
      const state = resizeStateRef.current;
      if (!state) return;
      const nextWidth = Math.max(
        RESULT_GRID_MIN_COLUMN_WIDTH,
        Math.min(RESULT_GRID_MAX_COLUMN_WIDTH, state.startWidth + clientX - state.startX)
      );
      setColumnWidthMap((current) => current[state.column] === nextWidth ? current : {
        ...current,
        [state.column]: nextWidth
      });
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!resizeStateRef.current) return;
      event.preventDefault();
      const clientX = event.clientX;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        applyResize(clientX);
      });
    };

    const stopResize = () => {
      resizeStateRef.current = null;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      document.body.classList.remove('result-grid-resizing');
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopResize);
    window.addEventListener('blur', stopResize);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopResize);
      window.removeEventListener('blur', stopResize);
      stopResize();
    };
  }, []);

  const startColumnResize = useCallback((event: ReactMouseEvent, column: string) => {
    event.preventDefault();
    event.stopPropagation();
    resizeStateRef.current = {
      column,
      startX: event.clientX,
      startWidth: getColumnWidth(column)
    };
    document.body.classList.add('result-grid-resizing');
  }, [getColumnWidth]);

  return {columnWidths, getColumnWidth, startColumnResize};
}

export function normalizeSelection(selection: GridSelection) {
  return {
    minRow: Math.min(selection.anchor.rowIndex, selection.focus.rowIndex),
    maxRow: Math.max(selection.anchor.rowIndex, selection.focus.rowIndex),
    minColumn: Math.min(selection.anchor.columnIndex, selection.focus.columnIndex),
    maxColumn: Math.max(selection.anchor.columnIndex, selection.focus.columnIndex)
  };
}

export function useResultGridSelection({
  columns,
  rowCount,
  viewportRef,
  columnOffsets,
  columnWidths,
  onBeginEdit,
  onCopySelection
}: {
  columns: string[];
  rowCount: number;
  viewportRef: RefObject<HTMLDivElement | null>;
  columnOffsets: number[];
  columnWidths: number[];
  onBeginEdit: (position: GridCellPosition) => void;
  onCopySelection: (selection: GridSelection) => void;
}) {
  const [selection, setSelection] = useState<GridSelection | null>(null);

  const clampPosition = useCallback((position: GridCellPosition): GridCellPosition => ({
    rowIndex: Math.max(0, Math.min(rowCount - 1, position.rowIndex)),
    columnIndex: Math.max(0, Math.min(columns.length - 1, position.columnIndex))
  }), [columns.length, rowCount]);

  const scrollToCell = useCallback((position: GridCellPosition) => {
    const node = viewportRef.current;
    if (!node || rowCount === 0 || columns.length === 0) return;
    const columnLeft = columnOffsets[position.columnIndex] ?? RESULT_GRID_INDEX_WIDTH;
    const columnRight = columnLeft + (columnWidths[position.columnIndex] ?? RESULT_GRID_COLUMN_WIDTH);
    const rowTop = RESULT_GRID_HEADER_HEIGHT + position.rowIndex * RESULT_GRID_ROW_HEIGHT;
    const rowBottom = rowTop + RESULT_GRID_ROW_HEIGHT;

    if (columnLeft < node.scrollLeft + RESULT_GRID_INDEX_WIDTH) {
      node.scrollLeft = Math.max(0, columnLeft - RESULT_GRID_INDEX_WIDTH);
    } else if (columnRight > node.scrollLeft + node.clientWidth) {
      node.scrollLeft = columnRight - node.clientWidth + 8;
    }

    if (rowTop < node.scrollTop + RESULT_GRID_HEADER_HEIGHT) {
      node.scrollTop = Math.max(0, rowTop - RESULT_GRID_HEADER_HEIGHT);
    } else if (rowBottom > node.scrollTop + node.clientHeight) {
      node.scrollTop = rowBottom - node.clientHeight + 8;
    }
  }, [columnOffsets, columnWidths, columns.length, rowCount, viewportRef]);

  const selectCell = useCallback((position: GridCellPosition, extend = false) => {
    if (rowCount === 0 || columns.length === 0) return;
    const nextFocus = clampPosition(position);
    setSelection((current) => {
      if (extend && current) return {anchor: current.anchor, focus: nextFocus};
      return {anchor: nextFocus, focus: nextFocus};
    });
    scrollToCell(nextFocus);
  }, [clampPosition, columns.length, rowCount, scrollToCell]);

  const isCellSelected = useCallback((rowIndex: number, columnIndex: number) => {
    if (!selection) return false;
    const range = normalizeSelection(selection);
    return rowIndex >= range.minRow && rowIndex <= range.maxRow && columnIndex >= range.minColumn && columnIndex <= range.maxColumn;
  }, [selection]);

  const isCellActive = useCallback((rowIndex: number, columnIndex: number) => {
    return selection?.focus.rowIndex === rowIndex && selection.focus.columnIndex === columnIndex;
  }, [selection]);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], .cell-popover')) return;
    if (!selection || rowCount === 0 || columns.length === 0) return;

    const extend = event.shiftKey;
    const focus = selection.focus;
    let next: GridCellPosition | null = null;

    if (event.key === 'ArrowUp') next = {...focus, rowIndex: focus.rowIndex - 1};
    if (event.key === 'ArrowDown') next = {...focus, rowIndex: focus.rowIndex + 1};
    if (event.key === 'ArrowLeft') next = {...focus, columnIndex: focus.columnIndex - 1};
    if (event.key === 'ArrowRight') next = {...focus, columnIndex: focus.columnIndex + 1};
    if (event.key === 'Home') next = {...focus, columnIndex: 0};
    if (event.key === 'End') next = {...focus, columnIndex: columns.length - 1};
    if (event.key === 'PageUp') next = {...focus, rowIndex: focus.rowIndex - Math.max(1, Math.floor((viewportRef.current?.clientHeight ?? 360) / RESULT_GRID_ROW_HEIGHT) - 2)};
    if (event.key === 'PageDown') next = {...focus, rowIndex: focus.rowIndex + Math.max(1, Math.floor((viewportRef.current?.clientHeight ?? 360) / RESULT_GRID_ROW_HEIGHT) - 2)};

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      onCopySelection(selection);
      return;
    }

    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      onBeginEdit(selection.focus);
      return;
    }

    if (!next) return;
    event.preventDefault();
    selectCell(next, extend);
  }, [columns.length, onBeginEdit, onCopySelection, rowCount, selectCell, selection, viewportRef]);

  return {
    selection,
    isCellActive,
    isCellSelected,
    onKeyDown,
    selectCell
  };
}

export function useVirtualResultGrid(columns: string[], rowCount: number, viewport: ViewportState, columnWidths: number[]): VirtualGrid {
  return useMemo(() => {
    const resolvedWidths = columns.map((_, index) => columnWidths[index] ?? RESULT_GRID_COLUMN_WIDTH);
    const columnOffsets: number[] = [];
    let totalWidth = RESULT_GRID_INDEX_WIDTH;
    for (const width of resolvedWidths) {
      columnOffsets.push(totalWidth);
      totalWidth += width;
    }
    const totalHeight = rowCount * RESULT_GRID_ROW_HEIGHT;

    const rowStart = Math.max(
      0,
      Math.floor(Math.max(0, viewport.scrollTop - RESULT_GRID_HEADER_HEIGHT) / RESULT_GRID_ROW_HEIGHT) - ROW_OVERSCAN
    );
    const visibleRowCount = Math.ceil(viewport.height / RESULT_GRID_ROW_HEIGHT) + ROW_OVERSCAN * 2;
    const rowEnd = Math.min(rowCount, rowStart + visibleRowCount);

    const columnScroll = Math.max(0, viewport.scrollLeft - RESULT_GRID_INDEX_WIDTH);
    let columnStart = 0;
    while (
      columnStart < columns.length &&
      columnOffsets[columnStart] + resolvedWidths[columnStart] < columnScroll + RESULT_GRID_INDEX_WIDTH
    ) {
      columnStart += 1;
    }
    columnStart = Math.max(0, columnStart - COLUMN_OVERSCAN);

    let columnEnd = columnStart;
    const visibleRight = viewport.scrollLeft + viewport.width;
    while (columnEnd < columns.length && columnOffsets[columnEnd] < visibleRight) {
      columnEnd += 1;
    }
    columnEnd = Math.min(columns.length, columnEnd + COLUMN_OVERSCAN);

    const rows: VirtualRow[] = [];
    for (let index = rowStart; index < rowEnd; index += 1) {
      rows.push({index, offsetTop: index * RESULT_GRID_ROW_HEIGHT});
    }

    const virtualColumns: VirtualColumn[] = [];
    for (let index = columnStart; index < columnEnd; index += 1) {
      virtualColumns.push({
        index,
        name: columns[index],
        offsetLeft: columnOffsets[index],
        width: resolvedWidths[index]
      });
    }

    return {rows, columns: virtualColumns, columnOffsets, columnWidths: resolvedWidths, totalWidth, totalHeight};
  }, [columnWidths, columns, rowCount, viewport.height, viewport.scrollLeft, viewport.scrollTop, viewport.width]);
}
