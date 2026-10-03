import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import '@babylonjs/core/Particles/particleSystemComponent';
import '@babylonjs/core/Shaders/particles.vertex';
import '@babylonjs/core/Shaders/particles.fragment';
import type { Scene } from '@babylonjs/core/scene';

function softPoint(scene: Scene, name: string): DynamicTexture {
  const texture = new DynamicTexture(name, 64, scene, true); texture.hasAlpha = true;
  const ctx = texture.getContext(), gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.24, 'rgba(255,255,255,.95)');
  gradient.addColorStop(.48, 'rgba(255,255,255,.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64); texture.update();
  return texture;
}

/** Stable irregular celestial directions, separate from nearby moving dust. */
export function createSolarSky(scene: Scene): void {
  let seed = 0x41524245;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars = new Mesh('fixed-solar-sky', scene), data = new VertexData();
  const positions: number[] = [], indices: number[] = [], colors: number[] = [], uvs: number[] = [];
  for (let i = 0; i < 2200; i++) {
    const z = 1 - 2 * random(), angle = random() * Math.PI * 2;
    const n = new Vector3(Math.sqrt(1 - z * z) * Math.cos(angle), z, Math.sqrt(1 - z * z) * Math.sin(angle));
    const magnitude = random() ** 3, brightness = .35 + magnitude * .9;
    const size = .095 + random() * .085 + magnitude * .22;
    const right = Vector3.Cross(n, Vector3.Up()).normalize().scale(size);
    const up = Vector3.Cross(right, n).normalize().scale(size);
    const center = n.scale(140), base = positions.length / 3;
    const temperature = random();
    const tint = temperature < .2 ? [1, .72 + random() * .18, .48 + random() * .2]
      : temperature > .75 ? [.57 + random() * .2, .76 + random() * .16, 1] : [1, .96, .88];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      positions.push(...center.add(right.scale(x!)).add(up.scale(y!)).asArray());
      colors.push(tint[0]! * brightness, tint[1]! * brightness, tint[2]! * brightness, 1);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  data.positions = positions; data.indices = indices; data.colors = colors; data.uvs = uvs; data.applyToMesh(stars);
  const starlight = new StandardMaterial('starlight', scene); starlight.disableLighting = true;
  starlight.emissiveColor = new Color3(1.6, 1.6, 1.6); starlight.backFaceCulling = false;
  starlight.diffuseTexture = softPoint(scene, 'stellar-core'); starlight.useAlphaFromDiffuseTexture = true;
  stars.material = starlight; stars.isPickable = false; stars.alwaysSelectAsActiveMesh = true;
  // No angular drift or parallax for stars, even when the camera follows the torus.
  scene.onBeforeRenderObservable.add(() => { if (scene.activeCamera) stars.position.copyFrom(scene.activeCamera.globalPosition); });

  const dust = new ParticleSystem('solar-space-dust', 180, scene);
  dust.particleTexture = softPoint(scene, 'space-dust-point');
  dust.emitter = Vector3.Zero(); dust.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  dust.color1 = new Color4(.55, .7, .85, .25); dust.color2 = new Color4(.85, .74, .53, .16);
  dust.colorDead = new Color4(.5, .6, .7, 0);
  dust.minSize = .012; dust.maxSize = .055;
  dust.minLifeTime = 90; dust.maxLifeTime = 150;
  dust.emitRate = 1.2; dust.updateSpeed = 1 / 60;
  dust.direction1 = new Vector3(.009, .003, -.004); dust.direction2 = new Vector3(.02, .009, .006);
  dust.minEmitPower = dust.maxEmitPower = 1;
  dust.addColorGradient(0, new Color4(.6, .72, .85, 0));
  dust.addColorGradient(.12, new Color4(.6, .72, .85, .25), new Color4(.85, .74, .53, .16));
  dust.addColorGradient(.8, new Color4(.6, .72, .85, .25), new Color4(.85, .74, .53, .16));
  dust.addColorGradient(1, new Color4(.6, .72, .85, 0));
  dust.startPositionFunction = (_matrix, position) => {
    const y = 2 * random() - 1, angle = random() * Math.PI * 2, radius = 10 + random() * 16;
    position.set(Math.sqrt(1 - y * y) * Math.cos(angle) * radius, y * radius,
      Math.sqrt(1 - y * y) * Math.sin(angle) * radius);
  };
  dust.preWarmCycles = 90; dust.preWarmStepOffset = 60;
  dust.start();
}
