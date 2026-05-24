import { useState, useEffect, useCallback } from 'react';
import type { AiProviderConfig, AppSettings, AppTheme, DbmindApi } from '../../shared/types';

export function useSettings({
  api, emptyAiProvider, setNotice, setLoadingFlag
}: {
  api: DbmindApi;
  emptyAiProvider: AiProviderConfig;
  setNotice: (msg: string) => void;
  setLoadingFlag: (k: 'settings', v: boolean) => void;
}) {
  const [settings, setSettings] = useState<AppSettings>({ aiProviders: [], defaultAiProviderId: undefined, theme: 'dark', selectedDatabasesByConnection: {} });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [aiDraft, setAiDraft] = useState<AiProviderConfig>(emptyAiProvider);

  useEffect(() => {
    api.getSettings().then((s) => {
      setSettings(s);
      setSettingsLoaded(true);
      setAiDraft(s.aiProviders.find((p) => p.id === s.defaultAiProviderId) ?? s.aiProviders[0] ?? emptyAiProvider);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveAiProvider = useCallback(async () => {
    setLoadingFlag('settings', true);
    try {
      const id = aiDraft.id || crypto.randomUUID();
      const provider = { ...aiDraft, id };
      const providers = [provider, ...settings.aiProviders.filter((p) => p.id !== id)];
      const next = await api.saveSettings({ ...settings, aiProviders: providers, defaultAiProviderId: id });
      setSettings(next); setAiDraft(provider);
      setNotice('AI 配置已保存');
    } catch (e) { setNotice(e instanceof Error ? e.message : 'AI 配置保存失败'); } finally { setLoadingFlag('settings', false); }
  }, [aiDraft, settings, api, setNotice, setLoadingFlag]);

  const testAiProvider = useCallback(async () => {
    setLoadingFlag('settings', true);
    try {
      const res = await api.testAiProvider({ ...aiDraft, id: aiDraft.id || 'draft' });
      setNotice(res.message);
    } catch (e) { setNotice(e instanceof Error ? e.message : 'AI 配置测试失败'); } finally { setLoadingFlag('settings', false); }
  }, [aiDraft, api, setNotice, setLoadingFlag]);

  const setDefaultProvider = useCallback(async (id: string) => {
    const next = await api.saveSettings({ ...settings, defaultAiProviderId: id });
    setSettings(next);
    const p = next.aiProviders.find((item) => item.id === id);
    if (p) setAiDraft(p);
  }, [settings, api]);

  const deleteAiProvider = useCallback(async (id: string) => {
    const providers = settings.aiProviders.filter((p) => p.id !== id);
    const next = await api.saveSettings({ ...settings, aiProviders: providers, defaultAiProviderId: providers[0]?.id });
    setSettings(next); setAiDraft(providers[0] ?? emptyAiProvider);
    setNotice('AI 配置已删除');
  }, [settings, api, emptyAiProvider, setNotice]);

  const saveTheme = useCallback(async (theme: AppTheme) => {
    const next = await api.saveSettings({ ...settings, theme });
    setSettings(next);
    setNotice(`界面风格已切换为 ${theme}`);
  }, [settings, api, setNotice]);

  return {
    settings, setSettings, settingsLoaded, setSettingsLoaded,
    aiDraft, setAiDraft,
    saveAiProvider, testAiProvider, setDefaultProvider, deleteAiProvider, saveTheme
  };
}
