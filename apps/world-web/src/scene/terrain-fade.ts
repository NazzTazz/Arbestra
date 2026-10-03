import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { TERRAIN_STREAMING } from './terrain-settings';

/** Presentation only: the last eight cells dissolve into the loading backdrop. */
export class TerrainFade extends MaterialPluginBase {
  constructor(material: StandardMaterial, private readonly bounds: () => [number, number, number]) {
    super(material, 'TerrainFade', 200, {}, true, false);
    this.registerForExtraEvents = true;
    this._enable(true);
  }
  override getUniforms() {
    return { ubo: [{ name: 'terrainBounds', size: 4, type: 'vec4' }], fragment: 'uniform vec4 terrainBounds;' };
  }
  override hardBindForSubMesh(buffer: UniformBuffer): void {
    const [x, z, radius] = this.bounds(); buffer.updateFloat4('terrainBounds', x, z, radius, Math.min(TERRAIN_STREAMING.fadeCells * 2.5, radius));
  }
  override getCustomCode(type: string) {
    return type === 'fragment' ? { CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
      float terrainDistance = max(abs(vPositionW.x - terrainBounds.x), abs(vPositionW.z - terrainBounds.y));
      float terrainFade = smoothstep(terrainBounds.z - terrainBounds.w, terrainBounds.z, terrainDistance);
      color.rgb = mix(color.rgb, vec3(0.5568627, 0.6274510, 0.6274510), terrainFade);
    ` } : null;
  }
}
