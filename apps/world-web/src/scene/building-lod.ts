import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Node } from '@babylonjs/core/node';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import { buildingLodRenderHeight, getBuildingLodSettings, type BuildingLodSettings } from './building-lod-settings';
import { countSceneEvent } from '../dev/statistics';

export function projectedDiameter(
  radius: number,
  depth: number,
  projectionY: number,
  height: number,
  orthographic = false,
): number {
  if (!orthographic && depth <= radius) return Infinity;
  return (radius * Math.abs(projectionY) * height) / (orthographic ? 1 : depth);
}

/** The logical building, its selection and its monuments never change identity. */
export function coordinateBuildingLod(
  parent: Mesh,
  detailed: readonly Node[],
  distant: readonly Node[],
  peripheral?: readonly Node[],
) {
  const scene = parent.getScene(),
    worldCentre = Vector3.Zero(),
    viewCentre = Vector3.Zero();
  const inverse = parent.computeWorldMatrix(true).clone().invert();
  const minimum = new Vector3(Infinity, Infinity, Infinity),
    maximum = minimum.negate();
  // Bounds of the entire recipe in parent coordinates, independent of origin and orientation.
  for (const node of detailed)
    for (const mesh of [...('getTotalVertices' in node ? [node as Mesh] : []), ...node.getChildMeshes()]) {
      if (!mesh.getTotalVertices()) continue;
      mesh.computeWorldMatrix(true);
      for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
        Vector3.TransformCoordinatesToRef(corner, inverse, worldCentre);
        minimum.minimizeInPlace(worldCentre);
        maximum.maximizeInPlace(worldCentre);
      }
    }
  const centre = Vector3.Center(minimum, maximum),
    radius = Vector3.Distance(minimum, maximum) / 2;
  let active: 'detailed' | 'peripheral' | 'distant' = 'detailed';
  const variants = { detailed, peripheral: peripheral ?? distant, distant };
  for (const node of [...distant, ...(peripheral ?? [])]) node.setEnabled(false);
  parent.metadata = {
    ...parent.metadata,
    buildingLod: { active, diameter: Infinity, pixelsPerMetre: Infinity, thresholds: getBuildingLodSettings() },
  };
  const state = parent.metadata.buildingLod;
  const update = (frame: LodFrame) => {
    if (!parent.isEnabled()) return;
    const world = parent.computeWorldMatrix(),
      m = world.m;
    Vector3.TransformCoordinatesToRef(centre, world, worldCentre);
    Vector3.TransformCoordinatesToRef(worldCentre, frame.view, viewCentre);
    const scale = Math.max(
      Math.hypot(m[0]!, m[1]!, m[2]!),
      Math.hypot(m[4]!, m[5]!, m[6]!),
      Math.hypot(m[8]!, m[9]!, m[10]!),
    );
    state.diameter = projectedDiameter(
      radius * scale,
      frame.rightHanded ? -viewCentre.z : viewCentre.z,
      frame.projectionY,
      frame.height,
      frame.orthographic,
    );
    // Normalise by the recipe's local size: an enlarged instance retains detail longer.
    state.pixelsPerMetre = state.diameter / (2 * radius);
    state.thresholds = frame.settings;
    const next = nextBuildingLod(active, state.pixelsPerMetre, frame.settings, !!peripheral);
    if (next === active) return;
    // Disable first: no frame can render or pick both representations.
    for (const node of variants[active]) node.setEnabled(false);
    for (const node of variants[next]) node.setEnabled(true);
    state.active = active = next;
    countSceneEvent('lodSwitches');
  };
  const registry = lodRegistry(scene);
  registry.add(update);
  parent.onDisposeObservable.addOnce(() => registry.delete(update));
}

export type BuildingLodLevel = 'detailed' | 'peripheral' | 'distant';
const RANK: Record<BuildingLodLevel, number> = { detailed: 0, peripheral: 1, distant: 2 };
/** Relative margin around each threshold. Without it a building whose size
 * sits on a threshold switched back and forth while the camera turned or
 * zoomed (282 switches a minute with no rebasing, 11 November). */
export const BUILDING_LOD_HYSTERESIS = 0.1;
function levelAt(pixelsPerMetre: number, near: number, far: number, peripheral: boolean): BuildingLodLevel {
  return pixelsPerMetre >= near ? 'detailed' : peripheral && pixelsPerMetre >= far ? 'peripheral' : 'distant';
}
/** A finer variant needs the threshold plus the margin, a coarser one the
 * threshold minus it; in between the building keeps its variant. */
export function nextBuildingLod(
  active: BuildingLodLevel,
  pixelsPerMetre: number,
  settings: Readonly<BuildingLodSettings>,
  peripheral: boolean,
): BuildingLodLevel {
  const up = 1 + BUILDING_LOD_HYSTERESIS,
    down = 1 - BUILDING_LOD_HYSTERESIS;
  const finer = levelAt(pixelsPerMetre, settings.near * up, settings.far * up, peripheral);
  if (RANK[finer] < RANK[active]) return finer;
  const coarser = levelAt(pixelsPerMetre, settings.near * down, settings.far * down, peripheral);
  if (RANK[coarser] > RANK[active]) return coarser;
  return active;
}

interface LodFrame {
  view: Matrix;
  projectionY: number;
  height: number;
  orthographic: boolean;
  rightHanded: boolean;
  settings: Readonly<BuildingLodSettings>;
}
/** One observer per scene for every building: the camera, the render height
 * and the settings are read once per frame instead of once per building. */
type LodUpdate = (frame: LodFrame) => void;
interface LodRegistry {
  add(update: LodUpdate): void;
  delete(update: LodUpdate): void;
}
const registries = new WeakMap<Scene, LodRegistry>();
function lodRegistry(scene: Scene): LodRegistry {
  const existing = registries.get(scene);
  if (existing) return existing;
  const updates = new Set<LodUpdate>();
  const frame: LodFrame = {
    view: Matrix.Identity(),
    projectionY: 1,
    height: 1,
    orthographic: false,
    rightHanded: false,
    settings: getBuildingLodSettings(),
  };
  let observer: Observer<Scene> | null = null;
  const evaluate = () => {
    const camera = scene.activeCamera;
    if (!camera) return;
    const engine = scene.getEngine();
    frame.view = camera.getViewMatrix();
    frame.projectionY = camera.getProjectionMatrix().m[5]!;
    frame.height =
      buildingLodRenderHeight(engine.getRenderHeight(), engine.getHardwareScalingLevel()) * camera.viewport.height;
    frame.orthographic = camera.mode === Camera.ORTHOGRAPHIC_CAMERA;
    frame.rightHanded = scene.useRightHandedSystem;
    frame.settings = getBuildingLodSettings();
    for (const update of updates) update(frame);
  };
  const registry: LodRegistry = {
    add(update) {
      updates.add(update);
      observer ??= scene.onBeforeActiveMeshesEvaluationObservable.add(evaluate);
    },
    delete(update) {
      updates.delete(update);
      if (updates.size || !observer) return;
      scene.onBeforeActiveMeshesEvaluationObservable.remove(observer);
      observer = null;
    },
  };
  registries.set(scene, registry);
  return registry;
}
