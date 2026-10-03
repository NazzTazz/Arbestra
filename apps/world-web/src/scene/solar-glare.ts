import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { LensFlareSystem } from '@babylonjs/core/LensFlares/lensFlareSystem';
import { LensFlare } from '@babylonjs/core/LensFlares/lensFlare';
import '@babylonjs/core/LensFlares/lensFlareSystemSceneComponent';
import '@babylonjs/core/Shaders/lensFlare.vertex';
import '@babylonjs/core/Shaders/lensFlare.fragment';
import '@babylonjs/core/Shaders/glowMapGeneration.vertex';
import '@babylonjs/core/Shaders/glowMapGeneration.fragment';
import '@babylonjs/core/Shaders/glowMapMerge.vertex';
import '@babylonjs/core/Shaders/glowMapMerge.fragment';
import '@babylonjs/core/Shaders/glowBlurPostProcess.fragment';
import '@babylonjs/core/Shaders/kernelBlur.vertex';
import '@babylonjs/core/Shaders/kernelBlur.fragment';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

/** Solar glare only: the sky and the dark side do not acquire their own glow. */
export function createSolarGlare(scene: Scene, sun: Mesh, torus: Mesh): void {
  const glow = new GlowLayer('solar-bloom', scene, { mainTextureFixedSize: 512, blurKernelSize: 48 });
  glow.addIncludedOnlyMesh(sun); glow.intensity = 1.5;
  const flares = new LensFlareSystem('solar-lens', sun, scene);
  flares.borderLimit = 220;
  flares.meshesSelectionPredicate = mesh => mesh === torus;
  const settings = [
    // Babylon 8.56 render() places 1 at the emitter, 0 at the screen center.
    { size: .5, position: 1, color: new Color3(1.6, 1.3, .85) },
    { size: .12, position: 1, color: new Color3(2.2, 2.1, 1.8) },
    { size: .08, position: .55, color: new Color3(.14, .22, .27) },
    { size: .045, position: .25, color: new Color3(.28, .18, .08) },
    { size: .14, position: -.25, color: new Color3(.13, .2, .16) },
  ];
  for (const [index, setting] of settings.entries()) {
    const texture = new DynamicTexture(`solar-lens-${index}`, 128, scene, false); texture.hasAlpha = true;
    const ctx = texture.getContext(), gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 63);
    // Native flare blend is ONE/ONE: fade RGB to black, not only alpha.
    gradient.addColorStop(0, 'rgb(255,248,226)');
    gradient.addColorStop(.12, 'rgb(180,163,142)');
    gradient.addColorStop(.4, 'rgb(24,21,17)');
    gradient.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128); texture.update();
    const flare = new LensFlare(setting.size, setting.position, setting.color, '', flares);
    flare.texture = texture;
  }
}
