export interface BuildingLodSettings { near: number; far: number }
// Render pixels per recipe metre: a 2 cm fastening becomes subpixel before the walls do.
export const DEFAULT_BUILDING_LOD: Readonly<BuildingLodSettings> = { near: 45, far: 28 };
const key = 'arbestra.building-lod.v1';
export function validBuildingLod(value: unknown): value is BuildingLodSettings {
  const settings = value as BuildingLodSettings | null;
  return !!settings && Number.isFinite(settings.near) && Number.isFinite(settings.far)
    && settings.far >= 5 && settings.near > settings.far && settings.near <= 200;
}
function initial(): BuildingLodSettings {
  if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
    try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null'); if (validBuildingLod(value)) return value; } catch { /* Storage may be unavailable. */ }
  }
  return { ...DEFAULT_BUILDING_LOD };
}
let settings = initial();
export function getBuildingLodSettings() { return settings; }
export function setBuildingLodSettings(value: BuildingLodSettings) {
  if (!validBuildingLod(value)) return false;
  settings = { ...value };
  if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* Session settings still work. */ }
  }
  return true;
}
