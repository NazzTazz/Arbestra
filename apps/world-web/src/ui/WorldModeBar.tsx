import { WORLD_MODES, type ActiveWorldMode } from './world-mode';

export function WorldModeBar({ mode, collapsed = false, onChoose }: { mode: ActiveWorldMode; collapsed?: boolean; onChoose: (mode: ActiveWorldMode) => void }) {
  return <nav className={`world-mode-bar${collapsed?' is-minimal':''}`} aria-label="Modes du monde">
    {WORLD_MODES.filter(item=>!collapsed||item.id===mode).map(item => <button key={item.id} type="button" aria-pressed={mode === item.id}
      aria-expanded={mode===item.id?!collapsed:undefined}
      aria-disabled={!item.available} title={item.available ? item.label : `${item.label} · À venir`}
      onClick={() => { if (item.available) onChoose(item.id as ActiveWorldMode); }}>
      <span aria-hidden="true">{item.icon}</span><b>{item.label}</b>{!item.available && <small>À venir</small>}
    </button>)}
  </nav>;
}
