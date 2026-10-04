import { WORLD_MODES, type ActiveWorldMode } from './world-mode';

export function WorldModeBar({ mode, onChoose }: { mode: ActiveWorldMode; onChoose: (mode: ActiveWorldMode) => void }) {
  return <nav className="world-mode-bar" aria-label="Modes du monde">
    {WORLD_MODES.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id}
      aria-disabled={!item.available} title={item.available ? item.label : `${item.label} · À venir`}
      onClick={() => { if (item.available) onChoose(item.id as ActiveWorldMode); }}>
      <span aria-hidden="true">{item.icon}</span><b>{item.label}</b>{!item.available && <small>À venir</small>}
    </button>)}
  </nav>;
}
