import { useState } from 'react';
import { ArrowLeft, CheckCircle2, Cpu, Edit3, Moon, Plus, Save, Settings, Sparkles, Sun, Trash2 } from 'lucide-react';
import type { AiProviderConfig, AppSettings, AppTheme } from '../../../shared/types';
const emptyAiProvider: AiProviderConfig = {
  id: '',
  name: 'OpenAI Compatible',
  provider: 'openai-compatible',
  apiMode: 'chat-completions',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5-mini',
  temperature: 0.2,
  maxOutputTokens: 1200,
  timeoutMs: 30000,
  streaming: true,
  defaultDialect: 'mysql',
  allowWriteSql: false,
  appendLimit: true
};

type SettingsTab = 'general' | 'ai';

export function SettingsView({
  aiDraft,
  settings,
  notice,
  onChange,
  onSave,
  onTest,
  onDefault,
  onEdit,
  onDelete,
  onThemeChange,
  onBack,
  sidebarWidth,
  loading,
  initialTab
}: {
  aiDraft: AiProviderConfig;
  settings: AppSettings;
  notice: string;
  onChange: (draft: AiProviderConfig) => void;
  onSave: () => void;
  onTest: () => void;
  onDefault: (id: string) => void;
  onEdit: (provider: AiProviderConfig) => void;
  onDelete: (id: string) => void;
  onThemeChange: (theme: AppTheme) => void;
  onBack: () => void;
  sidebarWidth: number;
  loading: boolean;
  initialTab?: SettingsTab;
}) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initialTab ?? 'general');
  const activeTheme = settings.theme ?? 'dark';

  return (
    <div className="settings-page">
      <nav className="settings-sidebar" style={{ width: sidebarWidth }}>
        <button className="settings-back-btn" onClick={onBack}>
          <ArrowLeft size={16} /> 返回
        </button>
        <div className="settings-nav-section">
          <p className="settings-nav-label">设置</p>
          <button
            className={`settings-nav-item ${settingsTab === 'general' ? 'active' : ''}`}
            onClick={() => setSettingsTab('general')}
          >
            <Settings size={16} /> 通用配置
          </button>
          <button
            className={`settings-nav-item ${settingsTab === 'ai' ? 'active' : ''}`}
            onClick={() => setSettingsTab('ai')}
          >
            <Sparkles size={16} /> AI 模型配置
          </button>
        </div>
      </nav>

      <div className="settings-content">
        <header className="settings-hero">
          <div>
            <p>Settings</p>
            <h1>{settingsTab === 'general' ? '通用配置' : 'AI 模型配置'}</h1>
            <span>{settingsTab === 'general' ? '调整桌面端显示风格与日常使用偏好。' : '兼容 OpenAI、OpenAI Compatible、Azure OpenAI、Ollama 与自定义 OpenAI 格式服务。'}</span>
          </div>
          {settingsTab === 'ai' && (
            <button onClick={() => onChange({ ...emptyAiProvider, id: '' })}><Plus size={16} /> 新建配置</button>
          )}
        </header>

        {settingsTab === 'general' ? (
          <section className="settings-section">
            <div className="settings-card">
              <div className="settings-card-head">
                <div>
                  <p>Appearance</p>
                  <h2>界面风格</h2>
                </div>
                {notice && <span>{notice}</span>}
              </div>
              <div className="theme-options">
                <button className={`theme-option ${activeTheme === 'dark' ? 'active' : ''}`} onClick={() => onThemeChange('dark')}>
                  <span className="theme-swatch dark"><Moon size={18} /></span>
                  <strong>Dark</strong>
                  <em>深色工作台，适合长时间编写 SQL。</em>
                </button>
                <button className={`theme-option ${activeTheme === 'light' ? 'active' : ''}`} onClick={() => onThemeChange('light')}>
                  <span className="theme-swatch light"><Sun size={18} /></span>
                  <strong>Light</strong>
                  <em>浅色界面，高对比表格与清爽面板。</em>
                </button>
              </div>
            </div>
          </section>
        ) : (
        <section className="settings-section">
          <div className="settings-card">
            <div className="settings-card-head">
              <div>
                <p>Provider Form</p>
                <h2>{aiDraft.id ? '编辑 AI 配置' : '新建 AI 配置'}</h2>
              </div>
              {notice && <span>{notice}</span>}
            </div>

            <div className="settings-grid">
              <label>
                名称
                <input value={aiDraft.name} onChange={(event) => onChange({ ...aiDraft, name: event.target.value })} />
              </label>
              <label>
                Provider
                <select value={aiDraft.provider} onChange={(event) => onChange({ ...aiDraft, provider: event.target.value as AiProviderConfig['provider'] })}>
                  <option value="openai">OpenAI</option>
                  <option value="openai-compatible">OpenAI Compatible</option>
                  <option value="azure-openai">Azure OpenAI</option>
                  <option value="ollama">Ollama</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label>
                API Mode
                <select value={aiDraft.apiMode} onChange={(event) => onChange({ ...aiDraft, apiMode: event.target.value as AiProviderConfig['apiMode'] })}>
                  <option value="chat-completions">/v1/chat/completions</option>
                  <option value="responses">/v1/responses</option>
                </select>
              </label>
              <label>
                Model
                <input value={aiDraft.model} onChange={(event) => onChange({ ...aiDraft, model: event.target.value })} />
              </label>
              <label className="wide">
                Base URL
                <input value={aiDraft.baseUrl} onChange={(event) => onChange({ ...aiDraft, baseUrl: event.target.value })} />
              </label>
              <label className="wide">
                API Key
                <input type="password" value={aiDraft.apiKey ?? ''} onChange={(event) => onChange({ ...aiDraft, apiKey: event.target.value })} />
              </label>
              <label>
                Temperature
                <input value={aiDraft.temperature} onChange={(event) => onChange({ ...aiDraft, temperature: Number(event.target.value) })} />
              </label>
              <label>
                Max Output Tokens
                <input value={aiDraft.maxOutputTokens} onChange={(event) => onChange({ ...aiDraft, maxOutputTokens: Number(event.target.value) })} />
              </label>
              <label>
                Timeout ms
                <input value={aiDraft.timeoutMs} onChange={(event) => onChange({ ...aiDraft, timeoutMs: Number(event.target.value) })} />
              </label>
              <label>
                默认 SQL 方言
                <select value={aiDraft.defaultDialect} onChange={(event) => onChange({ ...aiDraft, defaultDialect: event.target.value as AiProviderConfig['defaultDialect'] })}>
                  <option value="mysql">MySQL</option>
                  <option value="postgres">PostgreSQL</option>
                </select>
              </label>
            </div>

            <div className="settings-checks">
              <label><input type="checkbox" checked={Boolean(aiDraft.streaming)} onChange={(event) => onChange({ ...aiDraft, streaming: event.target.checked })} /> 启用流式输出</label>
              <label><input type="checkbox" checked={Boolean(aiDraft.appendLimit)} onChange={(event) => onChange({ ...aiDraft, appendLimit: event.target.checked })} /> 默认追加 LIMIT</label>
              <label><input type="checkbox" checked={Boolean(aiDraft.allowWriteSql)} onChange={(event) => onChange({ ...aiDraft, allowWriteSql: event.target.checked })} /> 允许 AI 生成写操作</label>
            </div>

            <div className="settings-actions">
              <button onClick={onTest} disabled={loading}><Cpu size={15} /> {loading ? '测试中' : '测试模型'}</button>
              <button className="primary" onClick={onSave} disabled={loading}><Save size={15} /> {loading ? '保存中' : '保存并设为默认'}</button>
            </div>
          </div>

          <div className="settings-card provider-list-card">
            <div className="settings-card-head">
              <div>
                <p>Providers</p>
                <h2>已保存配置</h2>
              </div>
            </div>
            <div className="provider-list">
              {settings.aiProviders.map((provider) => (
                <div className="provider-item" key={provider.id}>
                  <div>
                    <strong>{provider.name}</strong>
                    <span>{provider.model} · {provider.apiMode}</span>
                  </div>
                  <div className="provider-actions">
                    {settings.defaultAiProviderId === provider.id && <CheckCircle2 size={16} className="ok-icon" />}
                    <button onClick={() => onDefault(provider.id)}>默认</button>
                    <button onClick={() => onEdit(provider)}><Edit3 size={13} /></button>
                    <button onClick={() => onDelete(provider.id)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
