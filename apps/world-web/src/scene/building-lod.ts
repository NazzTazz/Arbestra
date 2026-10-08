import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Camera } from '@babylonjs/core/Cameras/camera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Node } from '@babylonjs/core/node';
import { getBuildingLodSettings } from './building-lod-settings';

export function projectedDiameter(radius: number, depth: number, projectionY: number, height: number, orthographic = false): number {
  if (!orthographic && depth <= radius) return Infinity;
  return radius * Math.abs(projectionY) * height / (orthographic ? 1 : depth);
}

/** The logical building, its selection and its monuments never change identity. */
export function coordinateBuildingLod(parent: Mesh, detailed: readonly Node[], distant: readonly Node[], peripheral?: readonly Node[]) {
  const scene = parent.getScene(), worldCentre = Vector3.Zero(), viewCentre = Vector3.Zero();
  const inverse = parent.computeWorldMatrix(true).clone().invert();
  const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = minimum.negate();
  // Bounds of the entire recipe in parent coordinates, independent of origin and orientation.
  for (const node of detailed) for (const mesh of [...('getTotalVertices' in node ? [node as Mesh] : []), ...node.getChildMeshes()]) {
    if (!mesh.getTotalVertices()) continue;
    mesh.computeWorldMatrix(true);
    for (const corner of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
      Vector3.TransformCoordinatesToRef(corner, inverse, worldCentre);
      minimum.minimizeInPlace(worldCentre); maximum.maximizeInPlace(worldCentre);
    }
  }
  const centre = Vector3.Center(minimum, maximum), radius = Vector3.Distance(minimum, maximum) / 2;
  let active: 'detailed' | 'peripheral' | 'distant' = 'detailed';
  const variants = { detailed, peripheral: peripheral ?? distant, distant };
  for (const node of [...distant, ...(peripheral ?? [])]) node.setEnabled(false);
  parent.metadata = { ...parent.metadata, buildingLod: { active, diameter: Infinity, pixelsPerMetre: Infinity, thresholds: getBuildingLodSettings() } };
  const state = parent.metadata.buildingLod;
  const observer = scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
    const camera = scene.activeCamera;
    if (!camera || !parent.isEnabled()) return;
    const world = parent.computeWorldMatrix(), m = world.m;
    Vector3.TransformCoordinatesToRef(centre, world, worldCentre);
    Vector3.TransformCoordinatesToRef(worldCentre, camera.getViewMatrix(), viewCentre);
    const scale = Math.max(Math.hypot(m[0]!, m[1]!, m[2]!), Math.hypot(m[4]!, m[5]!, m[6]!), Math.hypot(m[8]!, m[9]!, m[10]!));
    state.diameter = projectedDiameter(radius * scale, scene.useRightHandedSystem ? -viewCentre.z : viewCentre.z,
      camera.getProjectionMatrix().m[5]!, scene.getEngine().getRenderHeight() * camera.viewport.height,
      camera.mode === Camera.ORTHOGRAPHIC_CAMERA);
    // Normalise by the recipe's local size: an enlarged instance retains detail longer.
    state.pixelsPerMetre = state.diameter / (2 * radius);
    const settings = getBuildingLodSettings(); state.thresholds = settings;
    const next = state.pixelsPerMetre >= settings.near ? 'detailed'
      : peripheral && state.pixelsPerMetre >= settings.far ? 'peripheral' : 'distant';
    if (next === active) return;
    // Disable first: no frame can render or pick both representations.
    for (const node of variants[active]) node.setEnabled(false);
    for (const node of variants[next]) node.setEnabled(true);
    state.active = active = next;
  });
  parent.onDisposeObservable.addOnce(() => scene.onBeforeActiveMeshesEvaluationObservable.remove(observer));
}
