import { Database, History, Settings, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
type AppView = 'workspace' | 'settings';

export function LeftRail({
  view,
  aiCollapsed,
  onNavigate,
  onToggleAi
}: {
  view: AppView;
  aiCollapsed: boolean;
  onNavigate: (view: AppView) => void;
  onToggleAi: () => void;
}) {
  const { t } = useTranslation();
  return (
    <aside className="rail">
      <button className={`rail-btn ${view === 'workspace' ? 'active' : ''}`} title={t('sidebar.database')} onClick={() => onNavigate('workspace')}><Database size={18} /></button>
      <button className={`rail-btn ${view === 'workspace' && !aiCollapsed ? 'active' : ''}`} title={t('ai.title')} onClick={onToggleAi}><Sparkles size={18} /></button>
      <button className="rail-btn" title={t('history.title')}><History size={18} /></button>
      <button className={`rail-btn ${view === 'settings' ? 'active' : ''}`} title={t('settings.title')} onClick={() => onNavigate('settings')}><Settings size={18} /></button>
    </aside>
  );
}
