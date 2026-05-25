import {useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Check, Copy, Maximize2, X} from 'lucide-react';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import type {ColumnSchema} from '../../../shared/types';

export interface InlineCellEditorState {
  rowIndex: number;
  column: string;
  value: string;
  asNull: boolean;
}

interface PendingCellEdit {
  newValue: string;
  asNull: boolean;
}

interface EditableCellProps {
  rowIndex: number;
  column: string;
  value: unknown;
  reason: string | null;
  columnSchema?: ColumnSchema;
  pendingEdit?: PendingCellEdit;
  editorState: InlineCellEditorState | null;
  displayValue: string;
  isNullDisplay: boolean;
  onBeginEdit: () => void;
  onEditorChange: (next: InlineCellEditorState) => void;
  onCommit: (next: InlineCellEditorState) => void;
  onCancel: () => void;
  onCopy: () => void;
}

type CellEditorKind = 'text' | 'long-text' | 'json' | 'date' | 'datetime' | 'time' | 'number' | 'binary';

function inferEditorKind(column?: ColumnSchema, value?: unknown): CellEditorKind {
  const type = column?.type.toLowerCase() ?? '';
  if (/\b(json|jsonb)\b/.test(type)) return 'json';
  if (/\b(blob|binary|varbinary|bytea)\b/.test(type)) return 'binary';
  if (/\b(datetime|timestamp)\b/.test(type)) return 'datetime';
  if (/\bdate\b/.test(type)) return 'date';
  if (/\btime\b/.test(type)) return 'time';
  if (/\b(tinyint|smallint|mediumint|int|bigint|decimal|numeric|float|double|real)\b/.test(type)) return 'number';
  if (/\b(text|mediumtext|longtext)\b/.test(type)) return 'long-text';
  const text = value === null || value === undefined ? '' : String(value);
  if (looksLikeJson(text)) return 'json';
  if (text.length > 120 || text.includes('\n')) return 'long-text';
  return 'text';
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function toInputValue(value: string, kind: CellEditorKind): string {
  if (!value) return '';
  if (kind === 'datetime') return value.replace(' ', 'T').slice(0, 16);
  if (kind === 'date') return value.slice(0, 10);
  if (kind === 'time') return value.slice(0, 8);
  return value;
}

function fromInputValue(value: string, kind: CellEditorKind): string {
  if (kind === 'datetime') return value ? `${value.replace('T', ' ')}:00`.slice(0, 19) : '';
  return value;
}

function prettyJson(value: string): string {
  if (!value.trim()) return value;
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function JsonMonacoEditor({value, onChange}: { value: string; onChange: (value: string) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = monaco.editor.create(host, {
      value,
      language: 'json',
      theme: document.querySelector('.theme-light') ? 'vs' : 'vs-dark',
      automaticLayout: true,
      minimap: {enabled: false},
      scrollBeyondLastLine: false,
      lineNumbers: 'on',
      tabSize: 2,
      fontSize: 12,
      wordWrap: 'on',
      padding: {top: 10, bottom: 10}
    });
    editorRef.current = editor;
    const disposable = editor.onDidChangeModelContent(() => onChangeRef.current(editor.getValue()));
    return () => {
      disposable.dispose();
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) editor.setValue(value);
  }, [value]);

  return <div className="cell-json-monaco" ref={hostRef}/>;
}

function FloatingCellEditor({
  title,
  kind,
  state,
  onChange,
  onCommit,
  onCancel
}: {
  title: string;
  kind: CellEditorKind;
  state: InlineCellEditorState;
  onChange: (next: InlineCellEditorState) => void;
  onCommit: (next: InlineCellEditorState) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(() => kind === 'json' ? prettyJson(state.value) : state.value);
  const [asNull, setAsNull] = useState(state.asNull);

  useEffect(() => {
    onChange({...state, value, asNull});
  }, [asNull, value]);

  const commit = () => onCommit({...state, value, asNull});

  return createPortal(
    <div className="cell-popover-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onCancel();
    }}>
      <div className={`cell-popover cell-popover-${kind}`} role="dialog" aria-modal="true">
        <div className="cell-popover-head">
          <div>
            <strong>{title}</strong>
            <span>{kind === 'json' ? 'JSON 编辑器' : '多行文本编辑'}</span>
          </div>
          <button type="button" onClick={onCancel} title="取消">
            <X size={14}/>
          </button>
        </div>
        {kind === 'json' ? (
          <JsonMonacoEditor value={asNull ? '' : value} onChange={(next) => {
            setValue(next);
            setAsNull(false);
          }}/>
        ) : (
          <textarea
            autoFocus
            className="cell-long-editor"
            value={asNull ? '' : value}
            placeholder={asNull ? 'NULL' : ''}
            onChange={(event) => {
              setValue(event.target.value);
              setAsNull(false);
            }}
          />
        )}
        <div className="cell-popover-actions">
          <button type="button" className={asNull ? 'active' : ''} onClick={() => setAsNull(true)}>NULL</button>
          <button type="button" onClick={onCancel}>取消</button>
          <button type="button" className="primary" onClick={commit}>
            <Check size={14}/> 应用
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function EditableCell({
  rowIndex,
  column,
  value,
  reason,
  columnSchema,
  pendingEdit,
  editorState,
  displayValue,
  isNullDisplay,
  onBeginEdit,
  onEditorChange,
  onCommit,
  onCancel,
  onCopy
}: EditableCellProps) {
  const isEditing = editorState?.rowIndex === rowIndex && editorState.column === column;
  const editorKind = useMemo(() => inferEditorKind(columnSchema, pendingEdit ? pendingEdit.newValue : value), [columnSchema, pendingEdit, value]);
  const tdClass = [
    reason ? 'cell-readonly' : 'cell-editable',
    pendingEdit ? 'cell-edited' : '',
    isEditing ? 'cell-editing' : '',
    `cell-kind-${editorKind}`
  ].filter(Boolean).join(' ');
  const inputType = editorKind === 'number' ? 'number'
    : editorKind === 'date' ? 'date'
      : editorKind === 'datetime' ? 'datetime-local'
        : editorKind === 'time' ? 'time'
          : 'text';
  const needsFloatingEditor = isEditing && editorState && (editorKind === 'json' || editorKind === 'long-text');

  return (
    <td
      className={tdClass}
      title={reason ?? (pendingEdit ? '已修改，双击重新编辑' : '双击编辑')}
      onDoubleClick={onBeginEdit}
    >
      {isEditing && editorState ? (
        <>
          {needsFloatingEditor ? (
            <>
              <button type="button" className="cell-open-popover" onClick={onBeginEdit}>
                <Maximize2 size={13}/>
                {editorKind === 'json' ? 'JSON 编辑中' : '长文本编辑中'}
              </button>
              <FloatingCellEditor
                title={column}
                kind={editorKind}
                state={editorState}
                onChange={onEditorChange}
                onCommit={onCommit}
                onCancel={onCancel}
              />
            </>
          ) : editorKind === 'binary' ? (
            <div className="cell-editor-shell cell-editor-readonly">
              <span>二进制字段暂不支持行内编辑</span>
              <button type="button" onClick={onCancel}>关闭</button>
            </div>
          ) : (
            <div className="cell-editor-shell">
              <input
                className="cell-editor"
                autoFocus
                type={inputType}
                value={editorState.asNull ? '' : toInputValue(editorState.value, editorKind)}
                placeholder={editorState.asNull ? 'NULL' : ''}
                onChange={(event) => onEditorChange({
                  ...editorState,
                  value: fromInputValue(event.target.value, editorKind),
                  asNull: false
                })}
                onBlur={() => onCommit(editorState)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    onCommit(editorState);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onCancel();
                  }
                }}
              />
              <div className="cell-editor-actions">
                <button
                  type="button"
                  className={editorState.asNull ? 'active' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onCommit({...editorState, value: '', asNull: true})}
                  title="保存为 NULL"
                >
                  NULL
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onCommit(editorState)}
                  title="应用"
                >
                  <Check size={12}/>
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="cell-value-wrap">
          <span className={isNullDisplay ? 'cell-edited-null' : ''}>{displayValue}</span>
          <button
            className="cell-copy-btn"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onCopy();
            }}
            title="复制单元格"
          >
            <Copy size={11}/>
          </button>
        </div>
      )}
    </td>
  );
}
