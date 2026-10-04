export type WorldMode = 'exploration' | 'exploitation' | 'population' | 'construction' | 'amenagement' | 'army';
export type ActiveWorldMode = Exclude<WorldMode, 'amenagement' | 'army'>;
export const WORLD_MODES: Array<{ id: WorldMode; label: string; icon: string; available: boolean }> = [
  { id: 'exploration', label: 'Exploration', icon: '⌖', available: true },
  { id: 'exploitation', label: 'Exploitation', icon: '♨', available: true },
  { id: 'population', label: 'Population', icon: '♟', available: true },
  { id: 'construction', label: 'Construction', icon: '⌂', available: true },
  { id: 'amenagement', label: 'Aménagement', icon: '⌁', available: false },
  { id: 'army', label: 'Armée', icon: '⚑', available: false },
];

/** HUD intent is independent of the terrain LOD. */
export class WorldModeNavigation {
  mode: ActiveWorldMode = 'exploration';
  private villageMode: ActiveWorldMode = 'exploration';
  private requested: ActiveWorldMode | null = null;
  private view = 'village';
  choose(mode: ActiveWorldMode): boolean {
    if (this.view !== 'village' && mode !== 'exploration') { this.requested = mode; return true; }
    this.requested = null; this.mode = mode;
    return false;
  }
  changeView(view: string): ActiveWorldMode {
    if (this.view === 'village' && view !== 'village') this.villageMode = this.mode;
    if (view === 'village' && this.view !== 'village') {
      this.mode = this.requested ?? this.villageMode; this.requested = null;
    } else if (view !== 'village') this.mode = 'exploration';
    this.view = view;
    return this.mode;
  }
}
