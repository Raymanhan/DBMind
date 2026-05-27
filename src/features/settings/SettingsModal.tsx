import { useState, useCallback } from 'react';
import { X, Plus, Trash2, Check, Zap } from 'lucide-react';
import { useSettingsStore } from '../../shared/stores/settingsStore';
import type { AiConnection, AiProvider } from '../../shared/api/types';

const PROVIDERS: { value: AiProvider; label: string; urlHint: string }[] = [
  { value: 'compatible', label: 'OpenAI-compatible', urlHint: 'https://api.example.com/v1' },
  { value: 'openai', label: 'OpenAI', urlHint: 'https://api.openai.com/v1' },
  { value: 'ollama', label: 'Ollama (local)', urlHint: 'http://localhost:11434/v1' },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const ai = useSettingsStore((s) => s.ai);
  const setActiveId = useSettingsStore((s) => s.setActiveId);
  const addConnection = useSettingsStore((s) => s.addConnection);
  const updateConnection = useSettingsStore((s) => s.updateConnection);
  const deleteConnection = useSettingsStore((s) => s.deleteConnection);

  const editing = useSettingsStore((s) => {
    const config = s.ai;
    return config.connections.find((c) => c.id === config.activeId) ?? config.connections[0];
  });

  const providerMeta = PROVIDERS.find((p) => p.value === editing?.provider) ?? PROVIDERS[0];

  const handleAdd = useCallback(() => {
    const id = crypto.randomUUID();
    addConnection({
      id,
      name: `AI ${ai.connections.length + 1}`,
      provider: 'compatible',
      api_key: undefined,
      api_url: undefined,
      model: 'gpt-4o-mini',
      max_tokens: 4096,
      temperature: 0.1,
    });
  }, [addConnection, ai.connections.length]);

  const update = useCallback(
    (patch: Partial<AiConnection>) => {
      if (editing) updateConnection(editing.id, patch);
    },
    [editing, updateConnection],
  );

  if (!editing) return null;

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚙️ AI Settings</h2>
          <button className="modal-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* ── Active connection selector ── */}
          <div className="form-group">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Zap size={13} /> Active AI Connection
            </label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                className="ai-conn-select"
                value={editing.id}
                onChange={(e) => setActiveId(e.target.value)}
                style={{ flex: 1 }}
              >
                {ai.connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({PROVIDERS.find((p) => p.value === c.provider)?.label ?? c.provider})
                  </option>
                ))}
              </select>
              <button
                className="btn btn-sm"
                title="Add new connection"
                onClick={handleAdd}
                style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
              >
                <Plus size={14} /> New
              </button>
              {ai.connections.length > 1 && (
                <button
                  className="btn btn-sm btn-danger"
                  title="Delete this connection"
                  onClick={() => deleteConnection(editing.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* ── Divider ── */}
          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0' }} />

          {/* ── Connection settings ── */}
          <div className="form-group">
            <label>Connection Name</label>
            <input
              value={editing.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. My GPT-4"
            />
          </div>

          <div className="form-group">
            <label>Provider</label>
            <select value={editing.provider} onChange={(e) => update({ provider: e.target.value as AiProvider })}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          {editing.provider !== 'ollama' && (
            <div className="form-group">
              <label>API Key</label>
              <input
                type="password"
                value={editing.api_key ?? ''}
                onChange={(e) => update({ api_key: e.target.value || undefined })}
                placeholder="sk-..."
              />
            </div>
          )}

          <div className="form-group">
            <label>API Base URL</label>
            <input
              value={editing.api_url ?? ''}
              onChange={(e) => update({ api_url: e.target.value || undefined })}
              placeholder={providerMeta.urlHint}
            />
          </div>

          <div className="form-row">
            <div className="form-group flex-2">
              <label>Model</label>
              <input
                value={editing.model}
                onChange={(e) => update({ model: e.target.value })}
                placeholder="gpt-4o-mini"
              />
            </div>
            <div className="form-group flex-1">
              <label>Max Tokens</label>
              <input
                type="number"
                value={editing.max_tokens}
                onChange={(e) => update({ max_tokens: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Temperature <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>(0 = precise, 1 = creative)</span></label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={editing.temperature}
              onChange={(e) => update({ temperature: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
