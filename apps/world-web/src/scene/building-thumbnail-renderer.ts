import '@babylonjs/core/Shaders/default.vertex';
import '@babylonjs/core/Shaders/default.fragment';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { TimberThatch } from './timber-thatch';
import { buildPresentation } from './building-presentation';

/** Static PNG capture, shared by cached catalogue thumbnails and the resource workshop. */
export async function renderBuildingThumbnail(code: string, level: number,
  palette: { stoneColour?: string; woodColour?: string; quarterTurns?: number } = {}): Promise<string> {
    const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 240;
    const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: false }, false);
    let scene: Scene | undefined;
    try {
      scene = new Scene(engine);
      scene.clearColor = new Color4(0, 0, 0, 0);
      const camera = new ArcRotateCamera('catalogue', -Math.PI / 3, .94, 40, Vector3.Zero(), scene);
      camera.mode = Camera.ORTHOGRAPHIC_CAMERA; camera.minZ = .01; camera.maxZ = 200;
      const ambient = new HemisphericLight('catalogue-day', new Vector3(0, 1, 0), scene);
      ambient.intensity = .85; ambient.groundColor = new Color3(.35, .38, .32);
      new DirectionalLight('catalogue-sun', new Vector3(-.5, -1, .6), scene).intensity = .65;
      const kit = new TimberThatch(scene);
      if (palette.stoneColour) kit.stone.diffuseColor = Color3.FromHexString(palette.stoneColour);
      if (palette.woodColour) kit.wood.diffuseColor = Color3.FromHexString(palette.woodColour);
      const root = buildPresentation(kit, code, level);
      root.rotation.y += (palette.quarterTurns ?? 0) * Math.PI / 2;
      root.computeWorldMatrix(true); for (const mesh of root.getChildMeshes()) mesh.computeWorldMatrix(true);
      // Compact resources fit their actual silhouette, including angular fragments
      // and branches, instead of the empty corners of their enclosing boxes.
      const points: Vector3[] = [];
      if (code.startsWith('resource:')) for (const mesh of root.getChildMeshes()) {
        const positions = mesh.getVerticesData('position'); if (!positions) continue;
        for (let i = 0; i < positions.length; i += 3) points.push(Vector3.TransformCoordinates(Vector3.FromArray(positions, i), mesh.getWorldMatrix()));
      }
      const bounds = points.length ? {
        min: points.reduce((min, point) => Vector3.Minimize(min, point), points[0]!),
        max: points.reduce((max, point) => Vector3.Maximize(max, point), points[0]!),
      } : root.getHierarchyBoundingVectors(true);
      const centre = bounds.min.add(bounds.max).scale(.5); camera.setTarget(centre, false, false, code.startsWith('resource:'));
      // Fit all corners in camera space, so a campus is never cropped or distorted.
      const view = camera.getViewMatrix(true); let halfX = 0, halfY = 0;
      if (!points.length) for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new Vector3(x, y, z));
      for (const point of points) {
        const p = Vector3.TransformCoordinates(point, view); halfX = Math.max(halfX, Math.abs(p.x)); halfY = Math.max(halfY, Math.abs(p.y));
      }
      const half = Math.max(halfY, halfX / 1.6) * 1.08;
      camera.orthoLeft = -half * 1.6; camera.orthoRight = half * 1.6; camera.orthoTop = half; camera.orthoBottom = -half;
      await scene.whenReadyAsync(); scene.render();
      return canvas.toDataURL('image/png');
    } finally { scene?.dispose(); engine.dispose(); canvas.remove(); }
}
