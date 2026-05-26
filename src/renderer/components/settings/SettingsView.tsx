import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CheckCircle2, Cpu, Edit3, Globe, Moon, Plus, Save, Settings, Sparkles, Sun, Trash2 } from 'lucide-react';
import type { AiProviderConfig, AppSettings, AppTheme } from '../../../shared/types';
import { LANGUAGES } from '../../i18n';
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
  onLanguageChange,
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
  onLanguageChange: (lang: string) => void;
  onBack: () => void;
  sidebarWidth: number;
  loading: boolean;
  initialTab?: SettingsTab;
}) {
  const { t } = useTranslation();
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(initialTab ?? 'general');
  const activeTheme = settings.theme ?? 'dark';
  const isGeneral = settingsTab === 'general';

  return (
    <div className="settings-page">
      <nav className="settings-sidebar" style={{ width: sidebarWidth }}>
        <button className="settings-back-btn" onClick={onBack}>
          <ArrowLeft size={16} /> {t('settings.back')}
        </button>
        <div className="settings-nav-section">
          <p className="settings-nav-label">{t('settings.title')}</p>
          <button
            className={`settings-nav-item ${settingsTab === 'general' ? 'active' : ''}`}
            onClick={() => setSettingsTab('general')}
          >
            <Settings size={16} /> {t('settings.general')}
          </button>
          <button
            className={`settings-nav-item ${settingsTab === 'ai' ? 'active' : ''}`}
            onClick={() => setSettingsTab('ai')}
          >
            <Sparkles size={16} /> {t('settings.aiModel')}
          </button>
        </div>
      </nav>

      <div className="settings-content">
        <header className="settings-hero">
          <div>
            <p>{t('settings.title')}</p>
            <h1>{isGeneral ? t('settings.general') : t('settings.aiModel')}</h1>
            <span>{isGeneral ? t('settings.generalDescription') : t('settings.aiDescription')}</span>
          </div>
          {settingsTab === 'ai' && (
            <button onClick={() => onChange({ ...emptyAiProvider, id: '' })}><Plus size={16} /> {t('settings.newProvider')}</button>
          )}
        </header>

        {settingsTab === 'general' ? (
          <section className="settings-section">
            <div className="settings-card">
              <div className="settings-card-head">
                <div>
                  <p>{t('settings.appearance')}</p>
                  <h2>{t('settings.theme')}</h2>
                </div>
                {notice && <span>{notice}</span>}
              </div>
              <div className="theme-options">
                <button className={`theme-option ${activeTheme === 'dark' ? 'active' : ''}`} onClick={() => onThemeChange('dark')}>
                  <span className="theme-swatch dark"><Moon size={18} /></span>
                  <strong>{t('settings.themeDark')}</strong>
                  <em>{t('settings.themeDarkDescription')}</em>
                </button>
                <button className={`theme-option ${activeTheme === 'light' ? 'active' : ''}`} onClick={() => onThemeChange('light')}>
                  <span className="theme-swatch light"><Sun size={18} /></span>
                  <strong>{t('settings.themeLight')}</strong>
                  <em>{t('settings.themeLightDescription')}</em>
                </button>
              </div>
            </div>
            <div className="settings-card">
              <div className="settings-card-head">
                <div>
                  <p>{t('settings.language')}</p>
                  <h2>{t('settings.language')}</h2>
                </div>
              </div>
              <div className="settings-form-grid">
                <label>
                  <span><Globe size={13} /> {t('settings.interfaceLanguage')}</span>
                  <select
                    value={settings.language ?? 'zh-CN'}
                    onChange={(e) => onLanguageChange(e.target.value)}
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>{lang.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          </section>
        ) : (
        <section className="settings-section">
          <div className="settings-card">
            <div className="settings-card-head">
              <div>
                <p>{t('settings.providerForm')}</p>
                <h2>{aiDraft.id ? t('settings.editProvider') : t('settings.createProvider')}</h2>
              </div>
              {notice && <span>{notice}</span>}
            </div>

            <div className="settings-grid">
              <label>
                {t('settings.providerName')}
                <input value={aiDraft.name} onChange={(event) => onChange({ ...aiDraft, name: event.target.value })} />
              </label>
              <label>
                {t('settings.providerType')}
                <select value={aiDraft.provider} onChange={(event) => onChange({ ...aiDraft, provider: event.target.value as AiProviderConfig['provider'] })}>
                  <option value="openai">OpenAI</option>
                  <option value="openai-compatible">OpenAI Compatible</option>
                  <option value="azure-openai">Azure OpenAI</option>
                  <option value="ollama">Ollama</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              <label>
                {t('settings.apiMode')}
                <select value={aiDraft.apiMode} onChange={(event) => onChange({ ...aiDraft, apiMode: event.target.value as AiProviderConfig['apiMode'] })}>
                  <option value="chat-completions">/v1/chat/completions</option>
                  <option value="responses">/v1/responses</option>
                </select>
              </label>
              <label>
                {t('settings.model')}
                <input value={aiDraft.model} onChange={(event) => onChange({ ...aiDraft, model: event.target.value })} />
              </label>
              <label className="wide">
                {t('settings.baseUrl')}
                <input value={aiDraft.baseUrl} onChange={(event) => onChange({ ...aiDraft, baseUrl: event.target.value })} />
              </label>
              <label className="wide">
                {t('settings.apiKey')}
                <input type="password" value={aiDraft.apiKey ?? ''} onChange={(event) => onChange({ ...aiDraft, apiKey: event.target.value })} />
              </label>
              <label>
                {t('settings.temperature')}
                <input value={aiDraft.temperature} onChange={(event) => onChange({ ...aiDraft, temperature: Number(event.target.value) })} />
              </label>
              <label>
                {t('settings.maxTokens')}
                <input value={aiDraft.maxOutputTokens} onChange={(event) => onChange({ ...aiDraft, maxOutputTokens: Number(event.target.value) })} />
              </label>
              <label>
                {t('settings.timeout')}
                <input value={aiDraft.timeoutMs} onChange={(event) => onChange({ ...aiDraft, timeoutMs: Number(event.target.value) })} />
              </label>
              <label>
                {t('settings.defaultDialect')}
                <select value={aiDraft.defaultDialect} onChange={(event) => onChange({ ...aiDraft, defaultDialect: event.target.value as AiProviderConfig['defaultDialect'] })}>
                  <option value="mysql">MySQL</option>
                  <option value="postgres">PostgreSQL</option>
                </select>
              </label>
            </div>

            <div className="settings-checks">
              <label><input type="checkbox" checked={Boolean(aiDraft.appendLimit)} onChange={(event) => onChange({ ...aiDraft, appendLimit: event.target.checked })} /> {t('settings.appendLimit')}</label>
              <label><input type="checkbox" checked={Boolean(aiDraft.allowWriteSql)} onChange={(event) => onChange({ ...aiDraft, allowWriteSql: event.target.checked })} /> {t('settings.allowWriteSql')}</label>
            </div>

            <div className="settings-actions">
              <button onClick={onTest} disabled={loading}><Cpu size={15} /> {loading ? t('settings.testing') : t('settings.testProvider')}</button>
              <button className="primary" onClick={onSave} disabled={loading}><Save size={15} /> {loading ? t('settings.saving') : t('settings.saveProvider')}</button>
            </div>
          </div>

          <div className="settings-card provider-list-card">
            <div className="settings-card-head">
              <div>
                <p>{t('settings.providers')}</p>
                <h2>{t('settings.savedProviders')}</h2>
              </div>
            </div>
            <div className="provider-list">
              {settings.aiProviders.length ? settings.aiProviders.map((provider) => (
                <div className="provider-item" key={provider.id}>
                  <div>
                    <strong>{provider.name}</strong>
                    <span>{provider.model} · {provider.apiMode}</span>
                  </div>
                  <div className="provider-actions">
                    {settings.defaultAiProviderId === provider.id && <CheckCircle2 size={16} className="ok-icon" />}
                    <button onClick={() => onDefault(provider.id)}>{t('settings.setDefault')}</button>
                    <button onClick={() => onEdit(provider)} title={t('settings.edit')} aria-label={t('settings.edit')}><Edit3 size={13} /></button>
                    <button onClick={() => onDelete(provider.id)} title={t('settings.delete')} aria-label={t('settings.delete')}><Trash2 size={13} /></button>
                  </div>
                </div>
              )) : <p className="settings-empty">{t('settings.noProviders')}</p>}
            </div>
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
