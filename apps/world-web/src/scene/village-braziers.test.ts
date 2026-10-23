import { expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ClusteredLightContainer } from '@babylonjs/core/Lights/Clustered/clusteredLightContainer';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { Particle } from '@babylonjs/core/Particles/particle';
import type { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { bindBrazierLights, brazierBlocks, roadCorners, VillageBraziers } from './village-braziers';
import type { TravelRoute } from '@arbestra/contracts';
import { BrazierMeshIndex } from './brazier-mesh-index';

it('does not query fallback light receivers during the day, including after a night', () => {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { putImageData() {} };
      }
    },
  );
  vi.stubGlobal(
    'ImageData',
    class {
      data: Uint8ClampedArray;
      constructor(width: number, height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    },
  );
  const engine = new NullEngine(),
    scene = new Scene(engine),
    braziers = new VillageBraziers(scene);
  const nearby = vi.spyOn(BrazierMeshIndex.prototype, 'nearby');
  try {
    MeshBuilder.CreateBox('receiver', {}, scene);
    braziers.updatePoints([{ id: 'fire', x: 0, y: 0, z: 0, seed: 0.4 }]);
    for (let now = 1000; now <= 5000; now += 1000) braziers.animate(now, false, 1);
    expect(nearby).not.toHaveBeenCalled();
    braziers.animate(6000, true, 1);
    expect(nearby).toHaveBeenCalledTimes(1);
    for (let now = 7000; now <= 12000; now += 1000) braziers.animate(now, false, 1);
    expect(nearby).toHaveBeenCalledTimes(1);
    expect(scene.getLightByName('brazier-light-0')!.isEnabled()).toBe(false);
    expect(scene.getLightByName('brazier-light-0')!.intensity).toBe(0);
    braziers.animate(13000, true, 1);
    expect(nearby).toHaveBeenCalledTimes(2);
  } finally {
    nearby.mockRestore();
    braziers.dispose();
    scene.dispose();
    engine.dispose();
    vi.unstubAllGlobals();
  }
});

it('illuminates receivers with every brazier group within the material light budget and preserves independent lifetimes', () => {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { putImageData() {} };
      }
    },
  );
  vi.stubGlobal(
    'ImageData',
    class {
      data: Uint8ClampedArray;
      constructor(width: number, height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    },
  );
  const engine = new NullEngine(),
    scene = new Scene(engine);
  Object.assign(engine.getCaps(), {
    texelFetch: true,
    colorBufferFloat: true,
    blendFloat: true,
    shaderFloatPrecision: 23,
  });
  Object.defineProperty(engine, 'version', { value: 2 });
  new HemisphericLight('sky', Vector3.Up(), scene);
  new DirectionalLight('sun', Vector3.Down(), scene);
  const ground = MeshBuilder.CreateGround('receiver', { width: 20, height: 20 }, scene),
    material = new StandardMaterial('receiver', scene);
  ground.material = material;
  const groups = [new VillageBraziers(scene), new VillageBraziers(scene), new VillageBraziers(scene)];
  try {
    groups.forEach((group, i) => {
      group.updatePoints([{ id: `fire-${i}`, x: i, y: 0, z: 0, seed: 0.4 }]);
      group.animate(1000, true, 1);
    });
    const received = () =>
      ground.lightSources
        .slice(0, material.maxSimultaneousLights)
        .flatMap((light) => (light instanceof ClusteredLightContainer ? light.lights : []));
    expect(
      received()
        .map((light) => (light as PointLight).position.x)
        .sort(),
    ).toEqual([0, 1, 2]);
    const cluster = scene.lights.find((light) => light instanceof ClusteredLightContainer) as ClusteredLightContainer;
    expect(scene.lights.filter((light) => light instanceof ClusteredLightContainer)).toHaveLength(1);
    const [road, hall, workshop] = [0, 1, 2].map(
      (x) => cluster.lights.find((l) => (l as PointLight).position.x === x)!,
    );
    groups[0]!.animate(2000, false, 1);
    expect(road!.intensity).toBe(0);
    expect(hall!.intensity).toBeGreaterThan(0);
    expect(workshop!.intensity).toBeGreaterThan(0);
    expect(received()).toContain(hall);
    expect(received()).toContain(workshop);
    groups[1]!.animate(2000, true, 0);
    expect(hall!.intensity).toBe(0);
    expect(cluster.isEnabled()).toBe(true);
    groups[2]!.dispose();
    expect(workshop!.isDisposed()).toBe(true);
    expect(hall!.isDisposed()).toBe(false);
    expect(cluster.isEnabled()).toBe(false);
    groups[0]!.animate(3000, true, 1);
    expect(received()).toContain(road);
    expect(road!.intensity).toBeGreaterThan(0);
    groups[0]!.updatePoints([{ id: 'fire-0', x: -80, y: 0.5, z: -80, seed: 0.4 }]);
    expect(cluster.lights).toContain(road);
    expect((road as PointLight).position.asArray()).toEqual([-80, 0.66, -80]);
    groups[0]!.dispose();
    groups[1]!.dispose();
    expect(cluster.isDisposed()).toBe(true);
    expect(scene.lights.map((light) => light.name)).toEqual(['sky', 'sun']);
  } finally {
    for (const group of groups) group.dispose();
    scene.dispose();
    engine.dispose();
    vi.unstubAllGlobals();
  }
});

it.each(['equipment', 'decoration'])(
  'moves %s braziers with their lights and flames without rebuilding, then removes absent items',
  (kind) => {
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return { putImageData() {} };
        }
      },
    );
    vi.stubGlobal(
      'ImageData',
      class {
        data: Uint8ClampedArray;
        constructor(width: number, height: number) {
          this.data = new Uint8ClampedArray(width * height * 4);
        }
      },
    );
    const engine = new NullEngine(),
      scene = new Scene(engine),
      braziers = new VillageBraziers(scene);
    try {
      const point = {
        ...(kind === 'equipment' ? { id: 'brazier-1' } : { renderKey: 'campus:building:1' }),
        x: 10,
        y: 1,
        z: 20,
        seed: 0.4,
      };
      braziers.updatePoints([point]);
      const masonry = scene.getMeshByName('brazier-masonry')!,
        light = scene.getLightByName('brazier-light-0') as PointLight,
        flame = scene.particleSystems[0] as ParticleSystem;
      const particle = new Particle(flame);
      particle.position.set(10, 1.4, 20);
      flame.particles.push(particle);
      const centre = masonry.getBoundingInfo().boundingBox.centerWorld.clone(),
        emitter = (flame.emitter as Vector3).clone(),
        lightPosition = light.position.clone();
      braziers.updatePoints([{ ...point, x: -70, y: 1.5, z: -60 }]);
      const shift = new Vector3(-80, 0.5, -80);
      expect(scene.getMeshByName('brazier-masonry')).toBe(masonry);
      expect(masonry.isDisposed()).toBe(false);
      expect(masonry.isWorldMatrixFrozen).toBe(true);
      expect(masonry.isPickable).toBe(kind === 'equipment');
      expect(masonry.metadata?.equipmentId).toBe(kind === 'equipment' ? 'brazier-1' : undefined);
      expect(masonry.getBoundingInfo().boundingBox.centerWorld.equalsWithEpsilon(centre.add(shift), 1e-5)).toBe(true);
      expect(scene.particleSystems[0]).toBe(flame);
      expect((flame.emitter as Vector3).equalsWithEpsilon(emitter.add(shift))).toBe(true);
      expect(particle.position.equalsWithEpsilon(new Vector3(-70, 1.9, -60))).toBe(true);
      expect(scene.getLightByName('brazier-light-0')).toBe(light);
      expect(light.position.equalsWithEpsilon(lightPosition.add(shift))).toBe(true);
      braziers.updatePoints([]);
      expect(masonry.isDisposed()).toBe(true);
      expect(scene.particleSystems).toHaveLength(0);
      expect(scene.getLightByName('brazier-light-0')).toBeNull();
    } finally {
      braziers.dispose();
      scene.dispose();
      engine.dispose();
      vi.unstubAllGlobals();
    }
  },
);

it('registers clustered light shaders before the first night frame', () => {
  expect(ShaderStore.ShadersStore.lightProxyVertexShader).toContain('gl_Position');
  expect(ShaderStore.ShadersStore.lightProxyPixelShader).toContain('void main');
});

it('preserves unchanged light bindings and material readiness, but follows moving objects', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const mesh = MeshBuilder.CreateBox('house', {}, scene);
    const material = new StandardMaterial('stone', scene);
    mesh.material = material;
    material.freeze();
    mesh.computeWorldMatrix(true);
    const light = new PointLight('fire', Vector3.Zero(), scene);
    const unfreeze = vi.spyOn(material, 'unfreeze');
    bindBrazierLights([light], [mesh]);
    const bindings = light.includedOnlyMeshes;
    const enabled = vi.spyOn(light, 'setEnabled');
    for (let i = 0; i < 10; i++) bindBrazierLights([light], [mesh]);
    expect(light.includedOnlyMeshes).toBe(bindings);
    expect(unfreeze).toHaveBeenCalledTimes(1);
    expect(enabled).not.toHaveBeenCalled();
    mesh.position.x = 20;
    mesh.computeWorldMatrix(true);
    bindBrazierLights([light], [mesh]);
    expect(light.isEnabled()).toBe(false);
    mesh.position.x = 0;
    mesh.computeWorldMatrix(true);
    bindBrazierLights([light], [mesh]);
    expect(light.isEnabled()).toBe(true);
    expect(light.includedOnlyMeshes).toHaveLength(1);
    expect(light.includedOnlyMeshes[0]).toBe(mesh);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('lights shared building sources at each visible instance position and clears stale bindings', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const source = MeshBuilder.CreateBox('source', {}, scene);
    source.isVisible = false;
    source.material = new StandardMaterial('stone', scene);
    const a = source.createInstance('a'),
      b = source.createInstance('b');
    a.position.x = 20;
    b.position.x = 40;
    const left = new PointLight('left', new Vector3(20, 0, 0), scene),
      right = new PointLight('right', new Vector3(40, 0, 0), scene);
    for (const mesh of [source, a, b]) mesh.computeWorldMatrix(true);
    bindBrazierLights([left, right], [source, a, b]);
    expect(left.includedOnlyMeshes.map((m) => m.name)).toEqual(['a', 'source']);
    expect(right.includedOnlyMeshes.map((m) => m.name)).toEqual(['b', 'source']);
    expect(source.lightSources).toContain(left);
    expect(source.lightSources).toContain(right);
    a.dispose();
    bindBrazierLights([left, right], [source, b]);
    expect(left.isEnabled()).toBe(false);
    expect(right.isEnabled()).toBe(true);
    expect(source.lightSources.filter((l) => l.isEnabled())).toEqual([right]);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('finds bends and intersections once, but not straight sections or endpoints across a toric seam', () => {
  const cells = [
    { cellX: 63, cellY: 2 },
    { cellX: 0, cellY: 2 },
    { cellX: 1, cellY: 2 },
    { cellX: 1, cellY: 3 },
  ];
  const route: TravelRoute = { id: 'a', kind: 'building', cells, destination: cells[3]! };
  expect(roadCorners([route], 64, 64)).toEqual([cells[2]]);
  const branch: TravelRoute = {
    id: 'b',
    kind: 'stone',
    cells: [cells[1]!, { cellX: 0, cellY: 1 }],
    destination: { cellX: 0, cellY: 1 },
  };
  expect(roadCorners([route, route, branch], 64, 64)).toEqual([cells[1], cells[2]]);
});
it('builds two courses of four blocks with reversed joints and an open centre', () => {
  const blocks = brazierBlocks();
  expect(blocks).toHaveLength(8);
  for (let i = 0; i < 4; i++) {
    expect(blocks[i]!.y).toBe(0.5);
    expect(blocks[i + 4]!.y).toBe(1.5);
    expect(blocks[i + 4]!.x).toBeCloseTo(-blocks[i]!.x);
    expect(blocks[i + 4]!.z).toBeCloseTo(blocks[i]!.z);
    expect(Math.max(Math.abs(blocks[i]!.x), Math.abs(blocks[i]!.z))).toBeCloseTo(1.5);
  }
});
