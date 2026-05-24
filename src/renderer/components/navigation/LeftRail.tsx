import { Database, History, Settings, Sparkles } from 'lucide-react';
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
  return (
    <aside className="rail">
      <div className="brand">DB<span>Mind</span></div>
      <button className={`rail-btn ${view === 'workspace' ? 'active' : ''}`} title="数据库" onClick={() => onNavigate('workspace')}><Database size={18} /></button>
      <button className={`rail-btn ${view === 'workspace' && !aiCollapsed ? 'active' : ''}`} title="AI 助手" onClick={onToggleAi}><Sparkles size={18} /></button>
      <button className="rail-btn" title="历史"><History size={18} /></button>
      <button className={`rail-btn ${view === 'settings' ? 'active' : ''}`} title="设置" onClick={() => onNavigate('settings')}><Settings size={18} /></button>
    </aside>
  );
}
