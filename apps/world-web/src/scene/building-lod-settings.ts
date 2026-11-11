export interface BuildingLodSettings {
  near: number;
  far: number;
}
// Render pixels per recipe metre: a 2 cm fastening becomes subpixel before the walls do.
export const DEFAULT_BUILDING_LOD: Readonly<BuildingLodSettings> = { near: 45, far: 28 };
const key = 'arbestra.building-lod.v1';
export function validBuildingLod(value: unknown): value is BuildingLodSettings {
  const settings = value as BuildingLodSettings | null;
  return (
    !!settings &&
    Number.isFinite(settings.near) &&
    Number.isFinite(settings.far) &&
    settings.far >= 5 &&
    settings.near > settings.far &&
    settings.near <= 200
  );
}
function initial(): BuildingLodSettings {
  if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (validBuildingLod(value)) return value;
    } catch {
      /* Storage may be unavailable. */
    }
  }
  return { ...DEFAULT_BUILDING_LOD };
}
let settings = initial();
export function getBuildingLodSettings() {
  return settings;
}
export function setBuildingLodSettings(value: BuildingLodSettings) {
  if (!validBuildingLod(value)) return false;
  settings = { ...value };
  if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(key, JSON.stringify(settings));
    } catch {
      /* Session settings still work. */
    }
  }
  return true;
}

/** Hardware scaling the thresholds are expressed at (the scene's resting level).
 * Rendering P2 lowers the resolution while the camera moves: measured against
 * the live render height, every building near a threshold switched variant at
 * each start and stop of a motion (14 274 switches in a minute, 11 November).
 * Null: the live level, as before P2. */
let referenceScaling: number | null = null;
export function setBuildingLodReferenceScaling(level: number | null) {
  referenceScaling = level;
}
/** Render height in pixels at the reference scaling, whatever the live one. */
export function buildingLodRenderHeight(renderHeight: number, liveScaling: number): number {
  return referenceScaling === null ? renderHeight : (renderHeight * liveScaling) / referenceScaling;
}
