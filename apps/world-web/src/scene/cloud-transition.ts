import { Scene } from '@babylonjs/core/scene';
import { Layer } from '@babylonjs/core/Layers/layer';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import type { Engine } from '@babylonjs/core/Engines/engine';
// Keep shader registration in the same Vite graph as the engine, including warm caches.
import '@babylonjs/core/Shaders/layer.vertex';
import '@babylonjs/core/Shaders/layer.fragment';

/** One native fullscreen cloud layer, shared by both projections. No network wait. */
export class CloudTransition {
  readonly #scene: Scene;
  readonly #layer: Layer;
  readonly #wisps: Layer;
  get ready(): boolean { return this.#layer.isReady() && this.#wisps.isReady(); }
  covered = false;
  constructor(engine: Engine) {
    this.#scene = new Scene(engine); this.#scene.autoClear = false;
    new FreeCamera('cloud-camera', new Vector3(0, 0, -1), this.#scene);
    const texture = new DynamicTexture('transition-cloud-texture', 256, this.#scene, false);
    const context = texture.getContext();
    context.fillStyle = '#95abb6'; context.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 36; i++) {
      const x = (i * 97) % 256, y = (i * 53) % 256, radius = 35 + i % 5 * 12;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(243,249,252,.78)'); gradient.addColorStop(1, 'rgba(222,235,243,0)');
      context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
    }
    texture.update();
    this.#layer = new Layer('cloud-cover', null, this.#scene, false);
    this.#layer.texture = texture;
    this.#layer.color = new Color4(1, 1, 1, 0);
    this.#layer.onAfterRenderObservable.add(() => { this.covered = this.#layer.color.a === 1; });
    this.#wisps = new Layer('cloud-near-nappe', null, this.#scene, false);
    this.#wisps.texture = texture;
    this.#wisps.color = new Color4(1, 1, 1, 0);
  }
  render(alpha: number, now: number): void {
    this.covered = false;
    if (alpha <= 0) return;
    this.#layer.color.a = alpha;
    this.#layer.scale.set(1 + alpha * .2, 1 + alpha * .2);
    this.#layer.offset.set(Math.sin(now / 4000) * .025, alpha * .035);
    this.#wisps.color.a = alpha * .48;
    this.#wisps.scale.set(1.8 + alpha * .55, 1.8 + alpha * .55);
    this.#wisps.offset.set(-.12 - alpha * .12, -.18 + alpha * .08);
    this.#scene.render();
  }
  dispose(): void { this.#wisps.texture = null; this.#scene.dispose(); }
}
