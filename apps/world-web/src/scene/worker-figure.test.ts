import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { buildWorkerFigure, buildWorkerPresentation, villagerPieceData, type VillagerPiece } from './worker-figure';
import kit from './villager-kit.json';

/** Share of triangles whose normal points away from `centre`. */
function outward(name: VillagerPiece, centre: [number, number, number]) {
  const data = villagerPieceData(name),
    p = data.positions!,
    n = data.normals!;
  let out = 0;
  for (let v = 0; v < p.length; v += 9) {
    const c = [0, 1, 2].map((k) => (p[v + k]! + p[v + 3 + k]! + p[v + 6 + k]!) / 3 - centre[k]!);
    if (c[0]! * n[v]! + c[1]! * n[v + 1]! + c[2]! * n[v + 2]! > 0) out++;
  }
  return out / (p.length / 9);
}

describe('villager figurine kit', () => {
  it('turns every closed piece outwards in scene axes', () => {
    const head = kit.pivots.waist + 0.585 - 0.25 - kit.pivots.waist;
    expect(outward('tete', [0, head, 0])).toBeGreaterThan(0.95);
    expect(outward('tunique', [0, 0.1, 0])).toBeGreaterThan(0.95);
    expect(outward('bras', [0, -0.08, 0])).toBeGreaterThan(0.95);
    expect(outward('jambe', [0, -0.1, 0])).toBeGreaterThan(0.95);
  });

  it('keeps the eyes on the +Z face, the scene front', () => {
    const data = villagerPieceData('tete'),
      p = data.positions!,
      c = data.colors!;
    let front = 0,
      dark = 0;
    for (let v = 0; v < p.length / 3; v++)
      if (c[v * 4]! < 0.3) {
        dark++;
        if (p[v * 3 + 2]! > 0.09) front++;
      }
    expect(dark).toBeGreaterThan(0);
    expect(front).toBe(dark);
  });

  it('stands the feet on the ground below a root at 0.215 m', () => {
    const scene = new Scene(new NullEngine());
    const root = new TransformNode('w', scene),
      meshes: Mesh[] = [];
    const { limbs, waist } = buildWorkerFigure(
      root,
      (name, _tint, parent) => {
        const mesh = new Mesh(name, scene);
        villagerPieceData(name).applyToMesh(mesh);
        mesh.parent = parent;
        meshes.push(mesh);
        return mesh;
      },
      'court',
      'paille',
    );
    expect(meshes.map((m) => m.name).slice(0, 2)).toEqual(['tunique', 'tete']);
    expect(limbs).toHaveLength(4);
    expect(limbs[0]!.parent).toBe(waist);
    expect(limbs[2]!.parent).toBe(root);
    let low = Infinity,
      high = -Infinity;
    for (const mesh of meshes) {
      mesh.computeWorldMatrix(true);
      const box = mesh.getBoundingInfo().boundingBox;
      low = Math.min(low, box.minimumWorld.y);
      high = Math.max(high, box.maximumWorld.y);
    }
    expect(low + 0.215).toBeCloseTo(0, 1);
    expect(high + 0.215).toBeGreaterThan(0.69);
    scene.dispose();
  });

  it('builds factory portraits from the same pieces', () => {
    const scene = new Scene(new NullEngine());
    const group = buildWorkerPresentation(scene, 3);
    expect(group.getChildMeshes().length).toBe(3 * 9);
    scene.dispose();
  });
});
