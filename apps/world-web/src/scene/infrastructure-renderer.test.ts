import { it, expect, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import {
  emptyInfrastructure,
  infrastructurePlanSurface,
  infrastructureSidewalkSurface,
  type BuildingAccess,
  type TerrainChunk,
  type TerrainResponse,
  type TerrainUpdatesResponse,
  type VillageState,
} from '@arbestra/contracts';
import { InfrastructureRenderer } from './infrastructure-renderer';
import { WorldSpace } from './world-space';
import { TerrainStore } from './terrain-store';
import { TerrainRenderer } from './terrain-renderer';
import { VillageRoads } from './village-roads';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { createHash } from 'node:crypto';
import * as infrastructureContracts from '@arbestra/contracts';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

it('moves retained paving and sidewalks through chunk and torus rebases without rebuilding or resampling', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene, true);
  const borders = vi.spyOn(infrastructureContracts, 'infrastructureBorders');
  try {
    const plan = emptyInfrastructure(),
      space = new WorldSpace(512, 256, { cellX: 480, cellY: 224 });
    plan.roads = [
      {
        id: 'road',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 8, y: 8 },
          { x: 24, y: 8 },
        ],
      },
    ];
    const ground = vi.fn(() => 1),
      update = () =>
        renderer.update(
          plan,
          new WorldSpace(space.width, space.height, { ...space.origin }),
          ground,
          false,
          1,
          undefined,
          false,
          [],
          { followTerrain: true, groundIdentity: 'stable' },
        );
    update();
    const first = [...renderer.meshes],
      calls = borders.mock.calls.length;
    expect(first.length).toBeGreaterThan(1);
    const bounds = first.map((m) => m.getBoundingInfo().boundingBox.centerWorld.clone());
    ground.mockClear();
    for (const target of [
      { cellX: 0, cellY: 0 },
      { cellX: 32, cellY: 32 },
      { cellX: 480, cellY: 224 },
      { cellX: 0, cellY: 0 },
    ]) {
      const shift = space.rebase(target, 32)!;
      update();
      expect(renderer.meshes).toEqual(first);
      expect(ground).not.toHaveBeenCalled();
      expect(borders.mock.calls.length).toBe(calls);
      first.forEach((m, i) => {
        bounds[i]!.subtractInPlace(new Vector3(shift.x, 0, shift.z));
        expect(m.getBoundingInfo().boundingBox.centerWorld.equalsWithEpsilon(bounds[i]!, 1e-5)).toBe(true);
        expect(m.isWorldMatrixFrozen).toBe(true);
      });
    }
    // A real terrace received after rebasing still changes geometry at the new origin.
    ground.mockReturnValue(1.5);
    renderer.update(plan, space, ground, false, 2, undefined, false, [], {
      followTerrain: true,
      groundIdentity: 'terrace',
    });
    expect(first.every((m) => m.isDisposed())).toBe(true);
    renderer.meshes.forEach((m, i) => {
      const centre = m.getBoundingInfo().boundingBox.centerWorld;
      expect(centre.x).toBeCloseTo(bounds[i]!.x, 5);
      expect(centre.y).toBeCloseTo(bounds[i]!.y + 0.5, 5);
      expect(centre.z).toBeCloseTo(bounds[i]!.z, 5);
    });
  } finally {
    borders.mockRestore();
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('reprojects the opposite toric copy while retaining nearby road layers', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene, true),
    fresh = new InfrastructureRenderer(scene, true);
  try {
    const plan = emptyInfrastructure(),
      space = new WorldSpace(512, 256, { cellX: 0, cellY: 0 });
    plan.roads = [
      {
        id: 'near',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 8, y: 8 },
          { x: 24, y: 8 },
        ],
      },
      {
        id: 'opposite',
        operation: 'paint',
        material: 'earth',
        width: 4,
        border: false,
        points: [
          { x: 240 * 8, y: 8 },
          { x: 242 * 8, y: 8 },
        ],
      },
    ];
    const update = (r: InfrastructureRenderer) =>
      r.update(plan, space, () => 1, false, 1, undefined, false, [], { followTerrain: true, groundIdentity: 'stable' });
    update(renderer);
    const near = renderer.meshes.filter((m) => m.name === 'infrastructure-stone-1'),
      far = renderer.meshes.filter((m) => m.name === 'infrastructure-earth');
    space.rebase({ cellX: 480, cellY: 0 }, 32);
    update(renderer);
    update(fresh);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((m) => renderer.meshes.includes(m))).toBe(true);
    expect(far.every((m) => m.isDisposed())).toBe(true);
    renderer.meshes.forEach((m, i) => {
      expect(
        m
          .getBoundingInfo()
          .boundingBox.minimumWorld.equalsWithEpsilon(
            fresh.meshes[i]!.getBoundingInfo().boundingBox.minimumWorld,
            1e-4,
          ),
      ).toBe(true);
      expect(
        m
          .getBoundingInfo()
          .boundingBox.maximumWorld.equalsWithEpsilon(
            fresh.meshes[i]!.getBoundingInfo().boundingBox.maximumWorld,
            1e-4,
          ),
      ).toBe(true);
    });
  } finally {
    renderer.dispose();
    fresh.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('reuses the road topology when only ground changes while projecting the new heights', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene, true);
  const borders = vi.spyOn(infrastructureContracts, 'infrastructureBorders');
  try {
    const plan = emptyInfrastructure(),
      space = new WorldSpace(512, 256, { cellX: 10, cellY: 10 });
    plan.roads = [
      {
        id: 'road',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 80, y: 80 },
          { x: 96, y: 80 },
        ],
      },
    ];
    renderer.update(plan, space, () => 1, false, 1, undefined, false, [], {
      followTerrain: true,
      groundIdentity: 'ground-1',
    });
    const first = [...renderer.meshes],
      calls = borders.mock.calls.length;
    expect(first.every((mesh) => mesh.isWorldMatrixFrozen)).toBe(true);
    expect(calls).toBeGreaterThan(0);
    const heights = first.map((m) => Array.from(m.getVerticesData('position')!).filter((_, i) => i % 3 === 1));
    renderer.update(plan, space, () => 1.25, false, 2, undefined, false, [], {
      followTerrain: true,
      groundIdentity: 'ground-2',
    });
    expect(borders.mock.calls.length).toBe(calls);
    expect(first.every((m) => m.isDisposed())).toBe(true);
    renderer.meshes.forEach((m, i) =>
      Array.from(m.getVerticesData('position')!)
        .filter((_, j) => j % 3 === 1)
        .forEach((y, j) => expect(y - heights[i]![j]!).toBeCloseTo(0.25, 5)),
    );
    plan.roads[0]!.border = false;
    renderer.update(plan, space, () => 1.25, false, 3, undefined, false, [], {
      followTerrain: true,
      groundIdentity: 'ground-2',
    });
    expect(borders.mock.calls.length).toBeGreaterThan(calls);
    expect(renderer.meshes.some((m) => m.name === 'infrastructure-border')).toBe(false);
  } finally {
    borders.mockRestore();
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('retains road meshes for an unrelated chunk revision and rebuilds for local ground changes', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure();
    plan.roads = [
      {
        id: 'road',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 80, y: 80 },
          { x: 96, y: 80 },
        ],
      },
    ];
    const space = new WorldSpace(64, 64, { cellX: 10, cellY: 10 });
    renderer.update(plan, space, () => 0, false, 1);
    const first = [...renderer.meshes];
    expect(first.length).toBeGreaterThan(0);
    renderer.update(plan, space, () => 0, false, 2);
    expect(renderer.meshes).toEqual(first);
    expect(first.every((m) => !m.isDisposed())).toBe(true);
    renderer.update(plan, space, () => 0.2, false, 3);
    expect(renderer.meshes[0]).not.toBe(first[0]);
    expect(first.every((m) => m.isDisposed())).toBe(true);
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('renders wide flush sidewalks continuously across a building exit', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure();
    plan.roads = [
      {
        id: 'road',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 80, y: 80 },
          { x: 96, y: 80 },
        ],
      },
    ];
    const space = new WorldSpace(64, 64, { cellX: 10, cellY: 10 });
    renderer.update(plan, space, () => 0);
    const mesh = renderer.meshes.find((m) => m.name === 'infrastructure-border')!;
    const positions = mesh.getVerticesData('position')!;
    const z = positions.filter((_, i) => i % 3 === 2),
      y = positions.filter((_, i) => i % 3 === 1);
    // Four useful subdivisions plus two subdivisions of sidewalk on either side.
    expect(Math.max(...z) - Math.min(...z)).toBeCloseTo(2.5, 1); // perimeter grout retained
    expect(Math.max(...y)).toBeCloseTo(0.064);
    const exit = {
      position: { cellX: 11, cellY: 9.5 },
      outside: { cellX: 11, cellY: 10.5 },
      normal: { x: 0, y: 1 },
      width: 0.5,
    } as BuildingAccess;
    renderer.update(plan, space, () => 0, false, 0, undefined, false, [exit]);
    expect(renderer.meshes.find((m) => m.name === 'infrastructure-border')!.getVerticesData('position')).toEqual(
      positions,
    );
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('drapes confirmed and preview masonry onto continuous RC1 relief at every vertex', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure();
    plan.roads = [
      {
        id: 'road',
        operation: 'paint',
        material: 'earth',
        width: 4,
        border: false,
        points: [
          { x: 80, y: 80 },
          { x: 96, y: 80 },
        ],
      },
    ];
    const space = new WorldSpace(512, 256, { cellX: 5, cellY: 5 }),
      height = (x: number, y: number) => 2 + x * 0.1 + y * 0.2;
    for (const material of ['earth', 'rubble'] as const)
      for (const preview of [false, true]) {
        plan.roads[0]!.material = material;
        renderer.update(plan, space, height, preview, 1, undefined, false, [], { followTerrain: true });
        renderer.setInvalid(false);
        expect(renderer.materials.preview!.alpha).toBe(0.65);
        if (preview) {
          expect(renderer.meshes).toHaveLength(1);
          expect(renderer.meshes[0]!.getTotalVertices()).toBeLessThan(renderer.meshes[0]!.getTotalIndices() / 3);
          expect(
            renderer.meshes[0]!.getVerticesData('normal')!
              .filter((_, i) => i % 3 === 1)
              .every((y) => y > 0),
          ).toBe(true);
        }
        for (const mesh of renderer.meshes) {
          const p = mesh.getVerticesData('position')!;
          let min = Infinity,
            max = -Infinity;
          for (let i = 0; i < p.length; i += 3) {
            const c = space.inverse(p[i]!, p[i + 2]!);
            const relative = p[i + 1]! - height(c.cellX, c.cellY);
            min = Math.min(min, relative);
            max = Math.max(max, relative);
          }
          expect(max).toBeCloseTo(preview ? 0.04 : 0.015, 4);
          expect(min).toBeCloseTo(preview ? 0.04 : -0.01, 4);
          expect(mesh.material?.name).toBe('infrastructure-' + (preview ? 'preview' : material));
          if (material === 'rubble' && !preview)
            expect(renderer.materials.rubble!.diffuseColor.toHexString().toLowerCase()).toBe('#b7b8b2');
        }
      }
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('keeps the continuous preview local across both RC1 seams and includes its sidewalk footprint', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure();
    plan.roads = [
      {
        id: 'corner',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 4095, y: 2047 },
          { x: 1, y: 2047 },
          { x: 1, y: 1 },
        ],
      },
    ];
    const space = new WorldSpace(512, 256, { cellX: 0, cellY: 0 });
    renderer.update(plan, space, () => 2, true, 0, undefined, false, [], { followTerrain: true });
    renderer.setInvalid(true);
    expect(renderer.meshes).toHaveLength(1);
    const mesh = renderer.meshes[0]!,
      positions = mesh.getVerticesData('position')!,
      indices = mesh.getIndices()!;
    expect(mesh.isPickable).toBe(false);
    expect(renderer.materials.preview!.alpha).toBe(0.65);
    for (let i = 0; i < indices.length; i += 3)
      for (const axis of [0, 2]) {
        const v = [
          positions[indices[i]! * 3 + axis]!,
          positions[indices[i + 1]! * 3 + axis]!,
          positions[indices[i + 2]! * 3 + axis]!,
        ];
        expect(Math.max(...v) - Math.min(...v)).toBeLessThan(0.65);
      }
    expect(positions.filter((_, i) => i % 3 === 1).every((y) => Math.abs(y - 2.04) < 0.00001)).toBe(true);
    // The width includes two quarter-cell sidewalks beside the half-cell road.
    const x = positions.filter((_, i) => i % 3 === 0);
    expect(Math.max(...x) - Math.min(...x)).toBeGreaterThan(2);
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('reduces preview triangles while preserving every fine edge pixel and the total footprint', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure();
    plan.roads = [
      {
        id: 'edge',
        operation: 'paint',
        material: 'stone-1',
        width: 3,
        border: true,
        points: [
          { x: 81, y: 81 },
          { x: 96, y: 81 },
          { x: 96, y: 90 },
        ],
      },
    ];
    const space = new WorldSpace(512, 256, { cellX: 10, cellY: 10 }),
      surface = infrastructurePlanSurface(plan, { widthCells: 512, heightCells: 256 });
    const pixels = new Map([...surface].filter(([, p]) => p.manual));
    for (const [k, p] of infrastructureSidewalkSurface(surface, { widthCells: 512, heightCells: 256 }))
      pixels.set(k, { ...p, material: 'none', border: false, manual: true, axes: 0 });
    renderer.update(plan, space, (x, y) => 2 + x * 0.1 + y * 0.2, true, 0, undefined, false, [], {
      followTerrain: true,
    });
    const mesh = renderer.meshes[0]!,
      p = mesh.getVerticesData('position')!,
      indices = mesh.getIndices()!;
    let area = 0;
    const coverage = new Map<string, number>();
    for (let i = 0; i < indices.length; i += 6) {
      const vertices = [indices[i]!, indices[i + 1]!, indices[i + 2]!, indices[i + 5]!].map((j) =>
        space.inverse(p[j * 3]!, p[j * 3 + 2]!),
      );
      const xs = vertices.map((v) => Math.round(v.cellX * 16)),
        ys = vertices.map((v) => Math.round(v.cellY * 16));
      const x0 = Math.min(...xs),
        x1 = Math.max(...xs),
        y0 = Math.min(...ys),
        y1 = Math.max(...ys);
      area += (x1 - x0) * (y1 - y0);
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const key = x + ':' + y;
          coverage.set(key, (coverage.get(key) ?? 0) + 1);
        }
    }
    expect(area).toBe(pixels.size);
    expect([...coverage.keys()].sort()).toEqual([...pixels.keys()].sort());
    expect([...coverage.values()].every((n) => n === 1)).toBe(true);
    expect(indices.length / 3).toBeLessThan(pixels.size); // fine raster would have two triangles per pixel
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('updates only the changed road material and retains unrelated paving and sidewalks', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure(),
      space = new WorldSpace(512, 256, { cellX: 10, cellY: 10 });
    plan.roads = [
      {
        id: 'earth',
        operation: 'paint',
        material: 'earth',
        width: 4,
        border: false,
        points: [
          { x: 80, y: 80 },
          { x: 96, y: 80 },
        ],
      },
      {
        id: 'stone',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 160, y: 80 },
          { x: 176, y: 80 },
        ],
      },
    ];
    renderer.update(plan, space, () => 0, false, 0, undefined, false, [], { followTerrain: true });
    const earth = renderer.meshes.filter((m) => m.name === 'infrastructure-earth'),
      paving = renderer.meshes.filter((m) => m.name === 'infrastructure-stone-1'),
      sidewalks = renderer.meshes.filter((m) => m.name === 'infrastructure-border');
    expect(earth).toHaveLength(1);
    expect(paving.length).toBeGreaterThan(0);
    expect(sidewalks.length).toBeGreaterThan(0);
    plan.roads.push({
      id: 'new-earth',
      operation: 'paint',
      material: 'earth',
      width: 4,
      border: false,
      points: [
        { x: 80, y: 88 },
        { x: 96, y: 88 },
      ],
    });
    plan.revision++;
    renderer.update(plan, space, () => 0, false, 1, undefined, false, [], { followTerrain: true });
    expect(earth.every((m) => m.isDisposed())).toBe(true);
    expect(renderer.meshes.filter((m) => m.name === 'infrastructure-stone-1')).toEqual(paving);
    expect(renderer.meshes.filter((m) => m.name === 'infrastructure-border')).toEqual(sidewalks);
    const added = renderer.meshes.find((m) => m.name === 'infrastructure-earth')!;
    renderer.update(plan, space, (x) => (x < 15 ? 0.2 : 0), false, 2, undefined, false, [], { followTerrain: true });
    expect(added.isDisposed()).toBe(true);
    expect(renderer.meshes.filter((m) => m.name === 'infrastructure-stone-1')).toEqual(paving);
    expect(renderer.meshes.filter((m) => m.name === 'infrastructure-border')).toEqual(sidewalks);
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('keeps only exposed earth side walls across the RC1 corner seam', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure(),
      world = { widthCells: 512, heightCells: 256 };
    plan.roads = [
      {
        id: 'earth-seam',
        operation: 'paint',
        material: 'earth',
        width: 4,
        border: false,
        points: [
          { x: 4095, y: 2047 },
          { x: 1, y: 2047 },
          { x: 1, y: 1 },
        ],
      },
    ];
    const surface = infrastructurePlanSurface(plan, world),
      pixels = new Map([...surface].filter(([, p]) => p.manual));
    let edges = 0;
    for (const p of pixels.values())
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        if (!pixels.has(((p.x + dx! + 8192) % 8192) + ':' + ((p.y + dy! + 4096) % 4096))) edges++;
    renderer.update(plan, new WorldSpace(512, 256, { cellX: 0, cellY: 0 }), () => 2, false, 0, undefined, false, [], {
      followTerrain: true,
    });
    const wallNormals = renderer.meshes.flatMap((mesh) =>
      Array.from(mesh.getVerticesData('normal')!)
        .filter((_, i) => i % 3 === 1)
        .filter((n) => Math.abs(n) < 1e-6),
    );
    expect(wallNormals).toHaveLength(edges * 4);
    for (const mesh of renderer.meshes) {
      const positions = mesh.getVerticesData('position')!,
        indices = mesh.getIndices()!;
      for (let i = 0; i < indices.length; i += 3)
        for (const axis of [0, 2]) {
          const vs = [
            positions[indices[i]! * 3 + axis]!,
            positions[indices[i + 1]! * 3 + axis]!,
            positions[indices[i + 2]! * 3 + axis]!,
          ];
          expect(Math.max(...vs) - Math.min(...vs)).toBeLessThan(0.65);
        }
    }
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('retains distant earth sectors and invalidates exposed-wall halos after a neighboring removal', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure(),
      space = new WorldSpace(512, 256, { cellX: 10, cellY: 10 });
    plan.roads = [
      {
        id: 'cross-sector',
        operation: 'paint',
        material: 'earth',
        width: 4,
        border: false,
        points: [
          { x: 62, y: 80 },
          { x: 66, y: 80 },
        ],
      },
      {
        id: 'distant',
        operation: 'paint',
        material: 'earth',
        width: 4,
        border: false,
        points: [
          { x: 320, y: 80 },
          { x: 336, y: 80 },
        ],
      },
    ];
    renderer.update(plan, space, () => 1, false, 0, undefined, false, [], { followTerrain: true });
    const before = [...renderer.meshes];
    expect(before).toHaveLength(3);
    // The left sector has no new top pixels, but its shared edge becomes exposed.
    plan.roads.push({
      id: 'remove-right',
      operation: 'remove',
      material: 'none',
      width: 4,
      border: false,
      points: [
        { x: 64, y: 80 },
        { x: 66, y: 80 },
      ],
    });
    plan.revision++;
    renderer.update(plan, space, () => 1, false, 1, undefined, false, [], { followTerrain: true });
    expect(before[0]!.isDisposed()).toBe(true);
    expect(before[1]!.isDisposed()).toBe(true);
    expect(before[2]!.isDisposed()).toBe(false);
    expect(renderer.meshes).toContain(before[2]);
    expect(renderer.meshes).toHaveLength(2);
    const current = [...renderer.meshes];
    renderer.update(plan, space, () => 1, false, 2, undefined, false, [], { followTerrain: true });
    expect(renderer.meshes).toEqual(current);
    renderer.update(plan, space, (x) => (x < 15 ? 1.2 : 1), false, 3, undefined, false, [], { followTerrain: true });
    expect(current[0]!.isDisposed()).toBe(true);
    expect(before[2]!.isDisposed()).toBe(false);
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('uses the published ground identity before terrace mesh admission and tracks availability for both road layers', async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    material = new StandardMaterial('terrain', scene),
    roads = new InfrastructureRenderer(scene),
    automatic = new VillageRoads(scene);
  const initial = {
    world: { id: 'identity-world', generationVersion: 3, widthCells: 512, heightCells: 256, chunkSize: 32 },
    region: { originCellX: 0, originCellY: 0, width: 1, height: 1, terrainCodes: [1], elevations: [0], features: [] },
    cells: [],
    village: { extractions: [] },
  } as unknown as VillageState;
  const responses: Array<(response: TerrainResponse | TerrainUpdatesResponse) => void> = [];
  let now = 0;
  const store = new TerrainStore(
      initial,
      () => new Promise((resolve) => responses.push(resolve)),
      () => now,
    ),
    space = new WorldSpace(512, 256, { cellX: 0, cellY: 0 });
  const terrain = new TerrainRenderer(
    scene,
    store,
    space,
    material,
    material,
    () => [],
    () => [],
    () => [],
  );
  const demand = [{ key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0 }],
    plan = emptyInfrastructure();
  plan.roads = [
    {
      id: 'identity-road',
      operation: 'paint',
      material: 'earth',
      width: 4,
      border: false,
      points: [
        { x: 8, y: 8 },
        { x: 16, y: 8 },
      ],
    },
  ];
  const route = {
    id: 'automatic-identity',
    kind: 'building' as const,
    destination: { cellX: 3, cellY: 1 },
    cells: [
      { cellX: 1, cellY: 1 },
      { cellX: 3, cellY: 1 },
    ],
  };
  const ground = vi.fn((x: number, y: number) =>
    terrain.hasGround(x, y) ? (store.ground(x, y)?.height ?? null) : null,
  );
  const cellIdentity = (x: number, y: number) => (terrain.hasGround(x, y) ? store.groundRevisionAt(x, y) + 1 : 0);
  const update = () => {
    const identity = JSON.stringify([initial.world.id, store.groundRevision, terrain.groundVersion]);
    roads.update(plan, space, ground, false, terrain.groundVersion, undefined, false, [], {
      followTerrain: true,
      groundIdentity: identity,
      groundCellIdentity: cellIdentity,
    });
    automatic.update(
      'same-routes',
      [route],
      space,
      (cell) => {
        const height = ground(cell.cellX, cell.cellY);
        return height === null ? null : { code: 1, height };
      },
      true,
      identity,
      cellIdentity,
    );
  };
  const settle = async (index: number, value: TerrainChunk | TerrainUpdatesResponse['chunks'][number]) => {
    responses[index]!({ world: initial.world, chunks: [value] });
    await new Promise((r) => setTimeout(r, 0));
  };
  try {
    store.demandChunks(demand);
    terrain.demand(demand, (x, y) => x === 0 && y === 0);
    update();
    expect(roads.meshes).toHaveLength(0);
    now = 100;
    store.tick();
    const chunk: TerrainChunk = {
      chunkX: 0,
      chunkY: 0,
      originCellX: 0,
      originCellY: 0,
      terrainCodes: Array(34 ** 2).fill(1),
      elevations: Array(34 ** 2).fill(0),
      features: [],
      occupiedCells: [],
      rc1: { stride: 65, heights: Array(65 ** 2).fill(0.25), water: Array(65 ** 2).fill(0), terraces: [] },
    };
    await settle(0, chunk);
    update();
    expect(roads.meshes).toHaveLength(0); // fetched ground alone has not admitted its visible mesh
    terrain.demand(demand, (x, y) => x === 0 && y === 0);
    for (let i = 0; terrain.queued && i < 20; i++) terrain.tick();
    expect(terrain.queued).toBe(0);
    update();
    expect(roads.meshes.length).toBeGreaterThan(0);
    const before = roads.meshes[0]!,
      automatics = scene.meshes.filter((m) => m.name.startsWith('village-road-'));
    expect(automatics.length).toBeGreaterThan(0);
    ground.mockClear();
    update();
    expect(ground).not.toHaveBeenCalled();
    expect(roads.meshes[0]).toBe(before);
    const admittedVersion = terrain.version;
    now += 5000;
    store.tick();
    await settle(1, {
      chunkX: 0,
      chunkY: 0,
      originCellX: 0,
      originCellY: 0,
      features: [],
      occupiedCells: [],
      rc1Edits: { terraces: [{ cellX: 1, cellY: 1, height: 0.5 }] },
    });
    expect(terrain.version).toBe(admittedVersion);
    expect(terrain.queued).toBe(0);
    expect(store.ground(1, 1)!.height).toBe(1.25);
    update();
    expect(before.isDisposed()).toBe(true);
    expect(automatics.some((m) => m.isDisposed())).toBe(true);
    expect(
      Math.max(
        ...roads.meshes.flatMap((m) => Array.from(m.getVerticesData('position')!).filter((_, i) => i % 3 === 1)),
      ),
    ).toBeCloseTo(1.265);
    terrain.setVisible(false);
    expect(terrain.version).toBeGreaterThan(admittedVersion);
    update();
    expect(roads.meshes).toHaveLength(0);
    expect(scene.meshes.filter((m) => m.name.startsWith('village-road-'))).toHaveLength(0);
    terrain.setVisible(true);
    update();
    expect(roads.meshes.length).toBeGreaterThan(0);
    const beforeClear = terrain.version;
    store.geographyChanged();
    expect(terrain.version).toBe(beforeClear);
    update();
    expect(roads.meshes).toHaveLength(0);
    expect(scene.meshes.filter((m) => m.name.startsWith('village-road-'))).toHaveLength(0);
  } finally {
    automatic.dispose();
    roads.dispose();
    terrain.dispose();
    store.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('retains both road layers when rotation changes the camera mask over already published ground', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    material = new StandardMaterial('terrain', scene),
    roads = new InfrastructureRenderer(scene),
    automatic = new VillageRoads(scene);
  const chunk: TerrainChunk = {
    chunkX: 0,
    chunkY: 0,
    originCellX: 0,
    originCellY: 0,
    terrainCodes: Array(34 ** 2).fill(1),
    elevations: Array(34 ** 2).fill(0),
    features: [],
    occupiedCells: [],
    rc1: { stride: 65, heights: Array(65 ** 2).fill(0.5), water: Array(65 ** 2).fill(0), terraces: [] },
  };
  const demand = [{ key: '0:0', chunkX: 0, chunkY: 0, visible: true, distance: 0 }];
  const store = {
    world: { widthCells: 512, heightCells: 256, chunkSize: 32 },
    changed: new Set<string>(),
    demand,
    chunk: () => chunk,
    key: () => '0:0',
  };
  const space = new WorldSpace(512, 256, { cellX: 0, cellY: 0 }),
    terrain = new TerrainRenderer(
      scene,
      store as unknown as TerrainStore,
      space,
      material,
      material,
      () => [],
      () => [],
      () => [],
    );
  const plan = emptyInfrastructure();
  plan.roads = [
    {
      id: 'manual',
      operation: 'paint',
      material: 'stone-1',
      width: 4,
      border: true,
      points: [
        { x: 8, y: 16 },
        { x: 32, y: 16 },
      ],
    },
  ];
  const route = {
    id: 'automatic',
    kind: 'building' as const,
    destination: { cellX: 2, cellY: 2 },
    cells: [
      { cellX: 1, cellY: 2 },
      { cellX: 2, cellY: 2 },
    ],
  };
  const ground = vi.fn((x: number, y: number) => (terrain.hasGround(x, y) ? 1.25 : null));
  const update = () => {
    const identity = String(terrain.groundVersion);
    roads.update(plan, space, ground, false, terrain.groundVersion, undefined, false, [], {
      followTerrain: true,
      groundIdentity: identity,
    });
    automatic.update(
      'same-routes',
      [route],
      space,
      (c) => {
        const h = ground(c.cellX, c.cellY);
        return h === null ? null : { code: 1, height: h };
      },
      true,
      identity,
    );
  };
  try {
    terrain.demand(demand, (x, y) => x === 0 && y === 0);
    for (let frame = 0; terrain.queued && frame < 100; frame++) terrain.tick();
    expect(terrain.queued).toBe(0);
    update();
    const manual = [...roads.meshes],
      generated = scene.meshes.filter((m) => m.name.startsWith('village-road-'));
    expect(manual.length).toBeGreaterThan(0);
    expect(generated.length).toBeGreaterThan(0);
    const published = terrain.groundVersion;
    ground.mockClear();
    terrain.demand(demand, (x, y) => x === 4 && y === 0);
    expect(terrain.rendered(1, 1)).toBe(false);
    update();
    expect(ground).not.toHaveBeenCalled();
    expect(roads.meshes.map((m) => m.uniqueId)).toEqual(manual.map((m) => m.uniqueId));
    expect(scene.meshes.filter((m) => m.name.startsWith('village-road-')).map((m) => m.uniqueId)).toEqual(
      generated.map((m) => m.uniqueId),
    );
    expect([...manual, ...generated].every((m) => !m.isDisposed())).toBe(true);
    terrain.demand(demand.map((d) => ({ ...d, visible: false })));
    update();
    expect(terrain.groundVersion).toBe(published);
    expect(ground).not.toHaveBeenCalled();
    expect(roads.meshes.map((m) => m.uniqueId)).toEqual(manual.map((m) => m.uniqueId));
    expect(scene.meshes.filter((m) => m.name.startsWith('village-road-')).map((m) => m.uniqueId)).toEqual(
      generated.map((m) => m.uniqueId),
    );
    // True loss of resident visibility still removes the roads, then restores them.
    terrain.setVisible(false);
    update();
    expect(roads.meshes).toHaveLength(0);
    expect(scene.meshes.filter((m) => m.name.startsWith('village-road-'))).toHaveLength(0);
    terrain.setVisible(true);
    update();
    expect(roads.meshes.length).toBeGreaterThan(0);
    terrain.dispose();
    update();
    expect(terrain.groundVersion).toBeGreaterThan(published);
    expect(roads.meshes).toHaveLength(0);
    expect(scene.meshes.filter((m) => m.name.startsWith('village-road-'))).toHaveLength(0);
  } finally {
    automatic.dispose();
    roads.dispose();
    terrain.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('preserves the masonry triangles across sector boundaries and the toric seam', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure();
    plan.roads = [
      {
        id: 'stone-1',
        operation: 'paint',
        material: 'stone-1',
        width: 6,
        border: true,
        points: [
          { x: 58, y: 62 },
          { x: 70, y: 62 },
          { x: 70, y: 70 },
        ],
      },
      {
        id: 'stone-2',
        operation: 'paint',
        material: 'stone-2',
        width: 7,
        border: true,
        points: [
          { x: 120, y: 122 },
          { x: 136, y: 122 },
          { x: 136, y: 130 },
        ],
      },
      {
        id: 'seam',
        operation: 'paint',
        material: 'stone-1',
        width: 3,
        border: true,
        points: [
          { x: 4094, y: 20 },
          { x: 2, y: 20 },
        ],
      },
    ];
    renderer.update(
      plan,
      new WorldSpace(512, 256, { cellX: 0, cellY: 0 }),
      (x, y) => 0.5 + Math.sin(x) * 0.01 + Math.cos(y) * 0.02,
      false,
      0,
      undefined,
      false,
      [],
      { followTerrain: true },
    );
    const triangles: string[] = [];
    for (const mesh of renderer.meshes) {
      const p = mesh.getVerticesData('position')!,
        indices = mesh.getIndices()!;
      for (let i = 0; i < indices.length; i += 3)
        triangles.push(
          mesh.material!.name +
            ':' +
            Array.from(indices.slice(i, i + 3))
              .flatMap((j) => Array.from(p.slice(j * 3, j * 3 + 3)))
              .map((n) => n.toFixed(5))
              .join(','),
        );
    }
    const hash = createHash('sha256').update(triangles.sort().join('\n')).digest('hex');
    // Captured from the pre-sector renderer at 9c8dde4, independently of mesh grouping/order.
    expect({ triangles: triangles.length, hash }).toEqual({
      triangles: 12192,
      hash: 'b1f2a1a135ef8b8a7d804d647eac3a853128c42aa8395c194f6995ff0c17531f',
    });
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('rebuilds only nearby paving and sidewalks after local ground becomes available', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure();
    plan.roads = [
      {
        id: 'near',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 16, y: 16 },
          { x: 32, y: 16 },
        ],
      },
      {
        id: 'far',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 320, y: 16 },
          { x: 336, y: 16 },
        ],
      },
    ];
    const space = new WorldSpace(512, 256, { cellX: 0, cellY: 0 });
    renderer.update(plan, space, (x) => (x < 10 ? null : 0), false, 0, undefined, false, [], {
      followTerrain: true,
      groundIdentity: 'far-only',
    });
    const far = [...renderer.meshes];
    expect(far.length).toBeGreaterThan(1);
    renderer.update(plan, space, () => 0, false, 1, undefined, false, [], {
      followTerrain: true,
      groundIdentity: 'both',
    });
    expect(far.every((m) => !m.isDisposed() && renderer.meshes.includes(m))).toBe(true);
    const near = renderer.meshes.filter((m) => !far.includes(m));
    expect(near.length).toBeGreaterThan(1);
    renderer.update(plan, space, (x) => (x < 10 ? 0.25 : 0), false, 2, undefined, false, [], {
      followTerrain: true,
      groundIdentity: 'near-terrace',
    });
    expect(near.every((m) => m.isDisposed())).toBe(true);
    expect(far.every((m) => !m.isDisposed() && renderer.meshes.includes(m))).toBe(true);
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('skips remote ground publications and samples only changed cells while preserving distant meshes', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure(),
      space = new WorldSpace(512, 256, { cellX: 0, cellY: 0 });
    plan.roads = [
      {
        id: 'near',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 16, y: 16 },
          { x: 32, y: 16 },
        ],
      },
      {
        id: 'far',
        operation: 'paint',
        material: 'stone-2',
        width: 4,
        border: true,
        points: [
          { x: 320, y: 16 },
          { x: 336, y: 16 },
        ],
      },
    ];
    let near = 0,
      height = 0;
    const ground = vi.fn((x: number) => (x < 10 ? height : 0)),
      cellIdentity = (x: number) => (x < 10 ? near : 0);
    const update = (revision: number) =>
      renderer.update(plan, space, ground, false, revision, undefined, false, [], {
        followTerrain: true,
        groundIdentity: String(revision),
        groundCellIdentity: cellIdentity,
      });
    update(0);
    const first = [...renderer.meshes];
    ground.mockClear();
    update(1);
    expect(ground).not.toHaveBeenCalled();
    expect(renderer.meshes).toEqual(first);
    near++;
    height = 0.25;
    update(2);
    expect(ground.mock.calls.length).toBeGreaterThan(0);
    expect(ground.mock.calls.every(([x]) => x < 10)).toBe(true);
    expect(first.some((m) => m.isDisposed())).toBe(true);
    const far = first.filter((m) => m.name === 'infrastructure-stone-2');
    expect(far.length).toBeGreaterThan(0);
    expect(far.every((m) => renderer.meshes.includes(m))).toBe(true);
    const changed = [...renderer.meshes];
    near++;
    update(3);
    expect(renderer.meshes).toEqual(changed); // Same actual heights after a coarser chunk revision.
    ground.mockClear();
    update(4);
    expect(ground).not.toHaveBeenCalled();
    space.rebase({ cellX: 96, cellY: 96 }, 32);
    update(5);
    expect(renderer.meshes).toEqual(changed);
    expect(ground).not.toHaveBeenCalled();
    renderer.clear();
    update(6);
    expect(renderer.meshes.length).toBeGreaterThan(0);
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('does not reread unchanged ground probes when an earth stroke is added in another sector', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    renderer = new InfrastructureRenderer(scene);
  try {
    const plan = emptyInfrastructure(),
      space = new WorldSpace(512, 256, { cellX: 10, cellY: 10 });
    plan.roads = [
      {
        id: 'initial',
        operation: 'paint',
        material: 'earth',
        width: 4,
        border: false,
        points: [
          { x: 80, y: 80 },
          { x: 96, y: 80 },
        ],
      },
      {
        id: 'paving',
        operation: 'paint',
        material: 'stone-1',
        width: 4,
        border: true,
        points: [
          { x: 160, y: 80 },
          { x: 176, y: 80 },
        ],
      },
    ];
    const ground = vi.fn((x: number, y: number) => {
        void x;
        void y;
        return 1;
      }),
      options = { followTerrain: true, groundIdentity: 'same-published-ground' };
    renderer.update(plan, space, ground, false, 1, undefined, false, [], options);
    const initial = [...renderer.meshes];
    expect(ground.mock.calls.length).toBeGreaterThan(0);
    ground.mockClear();
    plan.roads.push({
      id: 'distant',
      operation: 'paint',
      material: 'earth',
      width: 4,
      border: false,
      points: [
        { x: 320, y: 80 },
        { x: 336, y: 80 },
      ],
    });
    plan.revision++;
    renderer.update(plan, space, ground, false, 2, undefined, false, [], options);
    expect(initial.every((m) => renderer.meshes.includes(m) && !m.isDisposed())).toBe(true);
    expect(ground.mock.calls.length).toBeGreaterThan(0);
    // Only the newly covered sector needs samples; existing earth, paving and sidewalks keep their probes.
    expect(ground.mock.calls.every((args) => args[0]! > 30)).toBe(true);
    ground.mockClear();
    renderer.update(plan, space, ground, false, 3, undefined, false, [], options);
    expect(ground).not.toHaveBeenCalled();
  } finally {
    renderer.dispose();
    scene.dispose();
    engine.dispose();
  }
});
