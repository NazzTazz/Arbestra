import { WORLD_MODES, type ActiveWorldMode } from './world-mode';

export function WorldModeBar({ mode, collapsed = false, beforeTownHall = false, onChoose }: { mode: ActiveWorldMode; collapsed?: boolean; beforeTownHall?: boolean; onChoose: (mode: ActiveWorldMode) => void }) {
  return <nav className={`world-mode-bar${collapsed?' is-minimal':''}`} aria-label="Modes du monde">
    {WORLD_MODES.map(item => beforeTownHall && (item.id === 'population' || item.id === 'exploitation') ? {...item, available:false} : item).filter(item=>!collapsed||item.id===mode).map(item => <button key={item.id} type="button" aria-pressed={mode === item.id}
      aria-expanded={mode===item.id?!collapsed:undefined}
      aria-disabled={!item.available} title={item.available ? item.label : `${item.label} · ${beforeTownHall ? "Posez l’hôtel de ville" : "À venir"}`}
      onClick={() => { if (item.available) onChoose(item.id as ActiveWorldMode); }}>
      <span aria-hidden="true">{item.icon}</span><b>{item.label}</b>{!item.available && <small>{beforeTownHall ? "Après l’HDV" : "À venir"}</small>}
    </button>)}
  </nav>;
}
