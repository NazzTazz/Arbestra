import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { TerrainOverview, TravelCell } from '@arbestra/contracts';
import { TAU, torusFrame, torusBlocksSegment } from './cosmology';
import { CELL_UNITS } from './world-space';

/** Unit-vector interpolation including opposite directions, without a zero-length midpoint. */
export function blendDirection(from: Vector3, to: Vector3, t: number): Vector3 {
  const dot=Math.max(-1,Math.min(1,Vector3.Dot(from,to)));
  if(dot>.999) return Vector3.Lerp(from,to,t).normalize();
  const angle=Math.acos(dot);
  const tangent=dot<-.999 ? Vector3.Cross(from,Math.abs(from.y)<.9 ? Vector3.Up() : Vector3.Right()).normalize()
    : to.subtract(from.scale(dot)).normalize();
  return from.scale(Math.cos(angle*t)).add(tangent.scale(Math.sin(angle*t))).normalize();
}

export function surfaceFrame(cell: TravelCell, world: TerrainOverview['world']) {
  return torusFrame(cell.cellX / world.widthCells * TAU, cell.cellY / world.heightCells * TAU + Math.PI);
}
/** Preserve the local footprint area; the two torus coordinate metrics differ. */
export function surfaceRadius(cell: TravelCell, world: TerrainOverview['world'], planarRadius: number, beta: number): number {
  const frame = surfaceFrame(cell, world);
  const eastMetric = TAU * Math.hypot(frame.point[0], frame.point[2]) / world.widthCells;
  const northMetric = TAU / world.heightCells;
  return Math.max(.06, planarRadius * Math.sqrt(eastMetric * northMetric) / CELL_UNITS / Math.sqrt(Math.max(.2, Math.cos(beta))));
}

/** Avoid the opposite tube when zooming out from the inner equator.
 * Keep the observed point fixed and move the eye along the nearest clear arc. */
export function keepSurfaceCameraClear(camera: ArcRotateCamera, anchor: Vector3, normal: Vector3): void {
  camera.getViewMatrix(true);
  const origin = anchor.add(normal.scale(.02));
  const clear = (position: Vector3) => !torusBlocksSegment([origin.x, origin.y, origin.z], [position.x, position.y, position.z]);
  const direction = camera.position.subtract(anchor).normalize();
  if (Vector3.Dot(direction, normal) > .05 && clear(camera.position)) return;
  const escape = normal.add(new Vector3(0, anchor.y < 0 ? -2 : 2, 0)).normalize();
  for (let i = 1; i <= 40; i++) {
    const candidate = anchor.add(Vector3.Lerp(direction, escape, i / 40).normalize().scale(camera.radius));
    if (clear(candidate)) { camera.setPosition(candidate); camera.inertialAlphaOffset = camera.inertialBetaOffset = 0; return; }
  }
}
export function attachSurfaceCamera(camera: ArcRotateCamera, parent: TransformNode,
  cell: TravelCell, world: TerrainOverview['world'], planarAlpha: number, radius: number): Vector3 {
  const frame = surfaceFrame(cell, world), point = Vector3.FromArray([...frame.point]);
  camera.parent = parent;
  camera.upVector = Vector3.FromArray([...frame.east]).scale(-Math.cos(planarAlpha))
    .add(Vector3.FromArray([...frame.north]).scale(-Math.sin(planarAlpha))).normalize();
  camera.setTarget(point);
  camera.setPosition(point.add(Vector3.FromArray([...frame.normal]).scale(radius)));
  camera.inertialAlphaOffset = camera.inertialBetaOffset = camera.inertialRadiusOffset = 0;
  return point;
}
