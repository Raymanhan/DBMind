import { X } from 'lucide-react';
import { useSettingsStore } from '../../shared/stores/settingsStore';

const PROVIDERS = [
  { value: 'openai' as const, label: 'OpenAI' },
  { value: 'ollama' as const, label: 'Ollama (local)' },
  { value: 'compatible' as const, label: 'OpenAI-compatible' },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const ai = useSettingsStore((s) => s.ai);
  const setAi = useSettingsStore((s) => s.setAi);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520 }}>
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>AI Provider</label>
            <select value={ai.provider} onChange={(e) => setAi({ provider: e.target.value as typeof ai.provider })}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {ai.provider !== 'ollama' && (
            <div className="form-group">
              <label>API Key</label>
              <input
                type="password"
                value={ai.api_key ?? ''}
                onChange={(e) => setAi({ api_key: e.target.value || undefined })}
                placeholder="sk-..."
              />
            </div>
          )}

          {(ai.provider === 'ollama' || ai.provider === 'compatible') && (
            <div className="form-group">
              <label>API URL</label>
              <input
                value={ai.api_url ?? ''}
                onChange={(e) => setAi({ api_url: e.target.value || undefined })}
                placeholder={ai.provider === 'ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
              />
            </div>
          )}

          <div className="form-row">
            <div className="form-group flex-2">
              <label>Model</label>
              <input
                value={ai.model}
                onChange={(e) => setAi({ model: e.target.value })}
                placeholder="gpt-4o-mini"
              />
            </div>
            <div className="form-group flex-1">
              <label>Max Tokens</label>
              <input
                type="number"
                value={ai.max_tokens}
                onChange={(e) => setAi({ max_tokens: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Temperature</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={ai.temperature}
              onChange={(e) => setAi({ temperature: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
