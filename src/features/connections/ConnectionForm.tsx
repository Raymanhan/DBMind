import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { ConnectionConfig, DatabaseDriver } from '../../shared/api/types';
import { testConnection, connect } from '../../shared/api/tauri';

interface ConnectionFormProps {
  onClose: () => void;
  onConnected: (config: ConnectionConfig) => void;
  initial?: Partial<ConnectionConfig>;
}

const DEFAULT_CONFIG: ConnectionConfig = {
  id: '',
  name: '',
  driver: 'mysql',
  host: 'localhost',
  port: 3306,
  username: 'root',
  password: '',
  database: '',
  ssl: false,
  extra_params: {},
};

export function ConnectionForm({ onClose, onConnected, initial }: ConnectionFormProps) {
  const [config, setConfig] = useState<ConnectionConfig>({
    ...DEFAULT_CONFIG,
    ...initial,
  });
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (field: keyof ConnectionConfig, value: unknown) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const ok = await testConnection(config);
      setTestResult(ok ? 'Connection successful' : 'Connection failed');
    } catch (e) {
      setTestResult(`Error: ${e}`);
    }
    setTesting(false);
  };

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const id = crypto.randomUUID();
      const finalConfig: ConnectionConfig = {
        ...config,
        id,
        name: config.name || `${config.host}:${config.port}`,
      };
      await connect(finalConfig);
      onConnected(finalConfig);
    } catch (e) {
      setError(String(e));
    }
    setConnecting(false);
  };

  const drivers: { value: DatabaseDriver; label: string; defaultPort: number }[] = [
    { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
    { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432 },
  ];

  return (
    <div className="modal-overlay">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Connection</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label>Connection Name</label>
            <input
              value={config.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="My Database"
            />
          </div>

          <div className="form-group">
            <label>Driver</label>
            <select
              value={config.driver}
              onChange={(e) => {
                const driver = e.target.value as DatabaseDriver;
                const defaultPort = drivers.find((d) => d.value === driver)?.defaultPort ?? 3306;
                update('driver', driver);
                update('port', defaultPort);
              }}
            >
              {drivers.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group flex-2">
              <label>Host</label>
              <input
                value={config.host}
                onChange={(e) => update('host', e.target.value)}
                placeholder="localhost"
              />
            </div>
            <div className="form-group flex-1">
              <label>Port</label>
              <input
                type="number"
                value={config.port}
                onChange={(e) => update('port', Number(e.target.value))}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Username</label>
            <input
              value={config.username}
              onChange={(e) => update('username', e.target.value)}
              placeholder="root"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={config.password ?? ''}
              onChange={(e) => update('password', e.target.value || undefined)}
              placeholder="Password"
            />
          </div>

          <div className="form-group">
            <label>Database (optional)</label>
            <input
              value={config.database ?? ''}
              onChange={(e) => update('database', e.target.value || undefined)}
              placeholder="Leave empty to list all"
            />
          </div>

          {testResult && (
            <div className={`form-message ${testResult.includes('successful') ? 'success' : 'error'}`}>
              {testResult}
            </div>
          )}
          {error && <div className="form-message error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 size={14} className="spin" /> : null}
            Test Connection
          </button>
          <button className="btn btn-primary" onClick={handleConnect} disabled={connecting}>
            {connecting ? <Loader2 size={14} className="spin" /> : null}
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}
