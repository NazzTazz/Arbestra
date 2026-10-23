import { expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { RegionalVillages } from './regional-villages';
import { WorldSpace } from './world-space';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { encodeBuildingAsset } from './building-asset-format';
import type { TerrainVillageOverview } from '@arbestra/contracts';

it('retains foreign geometry across unchanged samples and rebases, and releases removed villages', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    view = new RegionalVillages(scene);
  const world = { id: 'test', widthCells: 2048, heightCells: 1024, chunkSize: 32, generationVersion: 1 };
  const space = new WorldSpace(2048, 1024, { cellX: 2047, cellY: 1023 });
  try {
    for (let iteration = 0; iteration < 8; iteration++) {
      const previous = [...view.meshes.values()];
      view.set({
        world,
        sampledAt: new Date().toISOString(),
        truncated: false,
        villages: [
          {
            id: 'own',
            anchorCellX: 0,
            anchorCellY: 0,
            blocks: Array.from({ length: 64 }, (_, x) => ({ x, y: 0, width: 1, depth: 1, garden: x % 2 === 0 })),
          },
          {
            id: 'neighbor',
            anchorCellX: 2047,
            anchorCellY: 1023,
            blocks: [{ x: 0, y: 0, width: 2, depth: 2, garden: false }],
          },
        ],
      });
      view.update(space, 'own');
      expect(scene.meshes).toHaveLength(3);
      expect(scene.materials).toHaveLength(1);
      expect(previous.every((mesh) => !mesh.isDisposed())).toBe(true);
      expect(view.meshes.has('own')).toBe(false);
      expect(
        view.meshes
          .get('neighbor')!
          .getChildMeshes()
          .reduce((n, m) => n + m.getTotalVertices(), 0),
      ).toBeGreaterThan(24);
      expect(view.meshes.get('neighbor')!.visibility).toBe(1);
      space.rebase({ cellX: iteration * 32, cellY: 0 }, 32);
    }
    view.clear();
    expect(scene.meshes).toHaveLength(0);
    view.dispose();
    expect(scene.materials).toHaveLength(0);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('grounds roofed legacy exteriors on published terrain without rebuilding after rebase', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  let height = 7;
  const view = new RegionalVillages(scene, () => height),
    space = new WorldSpace(512, 256, { cellX: 511, cellY: 255 });
  try {
    view.set({
      world: { id: 'test', widthCells: 512, heightCells: 256, chunkSize: 32, generationVersion: 3 },
      sampledAt: 'now',
      truncated: false,
      villages: [{ anchorCellX: 0, anchorCellY: 0, blocks: [{ x: 0, y: 0, width: 2, depth: 1 }] }],
    });
    view.update(space, 'own', 1);
    const root = [...view.meshes.values()][0]!,
      body = root.getChildMeshes().find((m) => m.name.endsWith('building-0'))!;
    expect(root.position.x).toBe(2.5);
    expect(root.position.z).toBe(2.5);
    expect(body.position.y).toBeCloseTo(7.02);
    const shape = body.getChildMeshes()[0]!;
    expect(shape.getBoundingInfo().boundingBox.maximum.y).toBe(2.5);
    height = 9;
    space.rebase({ cellX: 0, cellY: 0 }, 32);
    view.update(space, 'own', 2);
    expect(root.position.x).toBe(0);
    expect(body.position.y).toBeCloseTo(9.02);
    expect(shape.isDisposed()).toBe(false);
  } finally {
    view.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('loads shared distant building models progressively and retains them across repeated samples', async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    view = new RegionalVillages(scene);
  const space = new WorldSpace(512, 256, { cellX: 0, cellY: 0 });
  const fetcher = vi.fn(async (url: string) => {
    expect(url).toContain('lod2');
    return new Response(encodeBuildingAsset({ meshes: [] }).slice().buffer, {
      headers: { 'content-encoding': 'gzip' },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(SceneLoader, 'LoadAssetContainerAsync').mockImplementation(async () => {
    const template = new AssetContainer(scene),
      root = new Mesh('template', scene),
      roof = MeshBuilder.CreateBox('actual-lod-roof', {}, scene);
    roof.parent = root;
    template.meshes.push(root, roof);
    template.removeAllFromScene();
    return template;
  });
  const data: TerrainVillageOverview = {
    world: { id: 'test', widthCells: 512, heightCells: 256, chunkSize: 32, generationVersion: 3 },
    sampledAt: 'first',
    truncated: false,
    villages: [
      {
        anchorCellX: 0,
        anchorCellY: 0,
        blocks: Array.from({ length: 4 }, (_, x) => ({
          x: x * 2,
          y: 0,
          width: 1,
          depth: 1,
          exterior: { model: 'dwelling-logs', level: 2, phase: 'finished', quarterTurns: 1 },
        })),
      },
    ],
  };
  try {
    view.set(data);
    view.update(space, 'own');
    await vi.waitFor(() =>
      expect(scene.meshes.filter((m) => m.name.includes('actual-lod-roof') && m.isVisible)).toHaveLength(2),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('dwelling-logs-2-finished-lod2');
    view.update(space, 'own');
    await vi.waitFor(() =>
      expect(scene.meshes.filter((m) => m.name.includes('actual-lod-roof') && m.isVisible)).toHaveLength(4),
    );
    const root = [...view.meshes.values()][0]!,
      models = root.getChildMeshes().filter((m) => m.getTotalVertices());
    expect(models).toHaveLength(4);
    expect(models.every((m) => !m.isPickable)).toBe(true);
    view.set({ ...data, sampledAt: 'later' });
    space.rebase({ cellX: 32, cellY: 0 }, 32);
    view.update(space, 'own');
    expect([...view.meshes.values()][0]).toBe(root);
    expect(models.every((m) => !m.isDisposed())).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    view.clear();
    expect(models.every((m) => m.isDisposed())).toBe(true);
  } finally {
    view.dispose();
    scene.dispose();
    engine.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

it('renders distinct anonymous volumes without picking or hiding them with the own village', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    view = new RegionalVillages(scene);
  try {
    const block = { x: 0, y: 0, width: 2, depth: 1 };
    view.set({
      world: {
        id: '10000000-0000-4000-8000-000000000001',
        generationVersion: 1,
        widthCells: 2048,
        heightCells: 1024,
        chunkSize: 32,
      },
      sampledAt: new Date().toISOString(),
      truncated: false,
      villages: [
        { id: 'own', anchorCellX: 0, anchorCellY: 0, blocks: [block] },
        { anchorCellX: 1, anchorCellY: 0, blocks: [block] },
        { anchorCellX: 2047, anchorCellY: 0, blocks: [block] },
      ],
    });
    view.update(new WorldSpace(2048, 1024, { cellX: 0, cellY: 0 }), 'own');
    expect(view.meshes.size).toBe(2);
    expect(view.meshes.has('own')).toBe(false);
    const anonymous = [...view.meshes].filter(([key]) => key !== 'own').map(([, mesh]) => mesh);
    expect(
      anonymous.every(
        (mesh) => mesh.isEnabled() && !mesh.isPickable && mesh.getChildMeshes().some((m) => m.getTotalVertices() > 24),
      ),
    ).toBe(true);
    expect(anonymous[0]!.position.x).toBeGreaterThan(0);
    expect(anonymous[1]!.position.x).toBeLessThan(0);
  } finally {
    view.dispose();
    scene.dispose();
    engine.dispose();
  }
});
