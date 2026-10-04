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

/** Called only on a cache miss, serialized by BuildingThumbnailCache. */
export async function renderBuildingThumbnail(code: string, level: number): Promise<string> {
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
      const root = buildPresentation(new TimberThatch(scene), code, level);
      root.computeWorldMatrix(true); for (const mesh of root.getChildMeshes()) mesh.computeWorldMatrix(true);
      const bounds = root.getHierarchyBoundingVectors(true);
      const centre = bounds.min.add(bounds.max).scale(.5); camera.setTarget(centre);
      // Fit all corners in camera space, so a campus is never cropped or distorted.
      const view = camera.getViewMatrix(true); let halfX = 0, halfY = 0;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const p = Vector3.TransformCoordinates(new Vector3(x, y, z), view); halfX = Math.max(halfX, Math.abs(p.x)); halfY = Math.max(halfY, Math.abs(p.y));
      }
      const half = Math.max(halfY, halfX / 1.6) * 1.08;
      camera.orthoLeft = -half * 1.6; camera.orthoRight = half * 1.6; camera.orthoTop = half; camera.orthoBottom = -half;
      await scene.whenReadyAsync(); scene.render();
      return canvas.toDataURL('image/png');
    } finally { scene?.dispose(); engine.dispose(); canvas.remove(); }
}
