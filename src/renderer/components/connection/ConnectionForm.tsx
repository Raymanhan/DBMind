import { KeyRound, Save } from 'lucide-react';
import type { DatabaseInfo, DbConnectionConfig } from '../../../shared/types';

export function ConnectionForm({
  draft,
  databases,
  loading,
  onChange,
  onSave,
  onTest
}: {
  draft: DbConnectionConfig;
  databases: DatabaseInfo[];
  loading: boolean;
  onChange: (draft: DbConnectionConfig) => void;
  onSave: () => void;
  onTest: () => void;
}) {
  return (
    <div className="connection-form">
      <div className="form-row">
        <span className="field-required"><input placeholder="连接名" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} /></span>
        <select
          value={draft.driver}
          onChange={(event) =>
            onChange({
              ...draft,
              driver: event.target.value as DbConnectionConfig['driver'],
              port: event.target.value === 'postgres' ? 5432 : 3306
            })
          }
        >
          <option value="mysql">MySQL</option>
          <option value="postgres">PostgreSQL</option>
        </select>
      </div>
      <div className="form-row">
        <span className="field-required"><input placeholder="Host" value={draft.host} onChange={(event) => onChange({ ...draft, host: event.target.value })} /></span>
        <input placeholder="Port" value={draft.port} onChange={(event) => onChange({ ...draft, port: Number(event.target.value) })} />
      </div>
      {databases.length > 0 ? (
        <select value={draft.database} onChange={(event) => onChange({ ...draft, database: event.target.value })}>
          <option value="">选择数据库</option>
          {databases.map((database) => (
            <option key={database.name} value={database.name}>{database.system ? `${database.name} · system` : database.name}</option>
          ))}
        </select>
      ) : (
        <input placeholder="Database" value={draft.database} onChange={(event) => onChange({ ...draft, database: event.target.value })} />
      )}
      <div className="form-row">
        <span className="field-required"><input placeholder="User" value={draft.user} onChange={(event) => onChange({ ...draft, user: event.target.value })} /></span>
        <input type="password" placeholder="Password" value={draft.password} onChange={(event) => onChange({ ...draft, password: event.target.value })} />
      </div>
      <div className="form-row">
        <input placeholder="Charset" value={draft.charset} onChange={(event) => onChange({ ...draft, charset: event.target.value })} />
        <input placeholder="Timeout ms" value={draft.connectTimeout} onChange={(event) => onChange({ ...draft, connectTimeout: Number(event.target.value) })} />
      </div>
      <label className="check-row">
        <input type="checkbox" checked={Boolean(draft.readonly)} onChange={(event) => onChange({ ...draft, readonly: event.target.checked })} />
        <span>只读模式</span>
      </label>
      <p className="form-hint"><span className="required-mark">*</span> 为必填项</p>
      <div className="form-actions">
        <button onClick={onTest} disabled={loading}><KeyRound size={14} /> {loading ? '测试中' : '测试'}</button>
        <button className="primary" onClick={onSave} disabled={loading}><Save size={14} /> {loading ? '保存中' : '保存'}</button>
      </div>
    </div>
  );
}
