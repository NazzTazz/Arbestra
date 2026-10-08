import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';
import type { WorldSpace } from './world-space';
import { COSMOLOGY } from './cosmology';
import { groundWetness, weatherAt, weatherSeed } from './weather';

/** One small shared texture for all LODs, owned by the local scene. */
export class WeatherMap {
  readonly texture: DynamicTexture;
  readonly seed: number;
  readonly sharedClimate: boolean;
  seconds = 0;
  #due = -Infinity;
  #wetDue = -Infinity;
  #job: Generator<void> | null = null;
  readonly #pixels = new ImageData(128, 64);
  readonly #wet = new Float32Array(16 * 8);
  constructor(scene: Scene, worldId: string, generatorSeed?: number) {
    this.seed = generatorSeed ?? weatherSeed(worldId); this.sharedClimate=generatorSeed!==undefined;
    this.texture = new DynamicTexture('shared-weather-field', { width: 128, height: 64 }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
    this.texture.wrapU = this.texture.wrapV = Texture.WRAP_ADDRESSMODE;
    this.texture.getContext().clearRect(0, 0, 128, 64); this.texture.update(false);
  }
  update(serverMs: number): void {
    this.seconds = ((serverMs - COSMOLOGY.epochMs) / 1000 % 14400 + 14400) % 14400;
    if (!this.#job && serverMs >= this.#due) {
      this.#due = serverMs + 2000; this.#job = this.#paint(serverMs);
    }
    const deadline = performance.now() + 2;
    while (this.#job && performance.now() < deadline) {
      if (this.#job.next().done) this.#job = null;
    }
  }
  *#paint(serverMs: number): Generator<void> {
    if (serverMs >= this.#wetDue) {
      this.#wetDue = serverMs + 30_000;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) {
        this.#wet[y * 16 + x] = groundWetness(x / 16, y / 8, serverMs, this.seed);
        yield;
      }
    }
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
      const u = (x + .5) / 128, v = (y + .5) / 64, weather = weatherAt(u, v, serverMs, this.seed, this.sharedClimate);
      const gx = u * 16, gy = v * 8, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
      const wet = (a: number, b: number) => this.#wet[(b % 8) * 16 + a % 16]!;
      const moisture = (wet(ix, iy) * (1 - fx) + wet(ix + 1, iy) * fx) * (1 - fy)
        + (wet(ix, iy + 1) * (1 - fx) + wet(ix + 1, iy + 1) * fx) * fy;
      const i = (y * 128 + x) * 4;
      this.#pixels.data[i] = weather.cloud * 255;
      this.#pixels.data[i + 1] = moisture * 255;
      this.#pixels.data[i + 2] = weather.rain * 255;
      this.#pixels.data[i + 3] = 255;
      if (x % 16 === 15) yield;
    }
    this.texture.getContext().putImageData(this.#pixels, 0, 0); this.texture.update(false);
  }
  dispose(): void { this.#job = null; this.texture.dispose(); }
}

type WeatherSurface = 'ground' | 'water' | 'leaves' | 'world';
/** Native StandardMaterial plugin keeps existing textures, lights, fog and batching. */
export class WeatherMaterial extends MaterialPluginBase {
  constructor(material: StandardMaterial, private readonly kind: WeatherSurface,
    private readonly map: () => WeatherMap | null, private readonly space: () => WorldSpace | null = () => null) {
    super(material, 'WeatherMaterial', 210, {}, true, false);
    this.registerForExtraEvents = true; this._enable(true);
  }
  override getSamplers(samplers: string[]): void { samplers.push('weatherMap'); }
  override getUniforms() {
    return { ubo: [{ name: 'weatherGeo', size: 4, type: 'vec4' }, { name: 'weatherClock', size: 4, type: 'vec4' }],
      vertex: 'uniform vec4 weatherClock;', fragment: 'uniform vec4 weatherGeo; uniform vec4 weatherClock;' };
  }
  override hardBindForSubMesh(buffer: UniformBuffer): void {
    const map = this.map(), space = this.space();
    buffer.updateFloat4('weatherGeo', space?.origin.cellX ?? 0, space?.origin.cellY ?? 0, space?.width ?? 1, space?.height ?? 1);
    buffer.updateFloat4('weatherClock', map?.seconds ?? 0, map ? 1 : 0, 0, 0);
    if (map) buffer.setTexture('weatherMap', map.texture);
  }
  override getCustomCode(type: string) {
    if (type === 'vertex') return {
      CUSTOM_VERTEX_DEFINITIONS: 'varying vec3 weatherLocalPosition;',
      CUSTOM_VERTEX_MAIN_END: 'weatherLocalPosition = position;',
      ...(this.kind === 'leaves' ? { CUSTOM_VERTEX_UPDATE_WORLDPOS: `
        float sway = sin(worldPos.x * .13 + worldPos.z * .09 + weatherClock.x * 1.5707963);
        worldPos.xz += vec2(1., .45) * sway * .045 * clamp(positionUpdated.y - .45, 0., 3.) * weatherClock.y;
      ` } : {}),
    };
    if (type !== 'fragment') return null;
    const toric = this.kind === 'world';
    const coordinates = toric ? `
      vec2 weatherUV = vec2(atan(weatherLocalPosition.z, weatherLocalPosition.x),
        atan(weatherLocalPosition.y, length(weatherLocalPosition.xz) - 2.4) - 3.14159265) / 6.2831853;
    ` : 'vec2 weatherUV = (vPositionW.xz / 2.5 + weatherGeo.xy) / weatherGeo.zw;';
    const effect = this.kind === 'water' ? `
      vec2 rippleCell = fract(vPositionW.xz * .6) - .5;
      float age = fract(weatherClock.x * .75 + floor(vPositionW.x * .6) * .37 + floor(vPositionW.z * .6) * .61);
      float ring = (1. - smoothstep(.015, .045, abs(length(rippleCell) - age * .48))) * (1. - age);
      color.rgb += vec3(.2,.28,.3) * ring * weatherSample.b;
      color.a = max(color.a, ring * weatherSample.b * .45);
    ` : 'color.rgb *= (1. - weatherSample.r * .22) * (1. - weatherSample.g * .18);';
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: 'varying vec3 weatherLocalPosition; uniform sampler2D weatherMap;',
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `${coordinates}
        vec3 weatherSample = texture2D(weatherMap, fract(weatherUV)).rgb * weatherClock.y;
        ${effect}
      `,
    };
  }
}
