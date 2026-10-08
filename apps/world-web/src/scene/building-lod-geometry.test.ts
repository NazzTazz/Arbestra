import { expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TimberThatch } from './timber-thatch';
import { buildUniversity } from './university-factory';
import { batchDistantBuilding, simplifyMasonry } from './building-lod-geometry';
import type { Stone } from './building-plan';
import { buildingPlan, HOUSE_RECIPE, LOG_HOUSE_RECIPE, BEAM_HOUSE_RECIPE, HALL_RECIPE } from './building-plan';

it('fills only mortar joints and preserves openings, shade and input stones', () => {
  const stone: Stone = { x: 0, y: .5, z: 0, length: .997, height: .997, thickness: .2, axis: 'x', shade: .96 };
  const input = [stone, { ...stone, x: 1, shade: 1 }, { ...stone, x: 3 }, { ...stone, z: 2 }];
  const merged = simplifyMasonry(input, .003);
  expect(merged).toHaveLength(3); expect(merged[0]!.length).toBeCloseTo(1.997);
  expect(merged[0]!.shade).toBeCloseTo(.98); expect(stone.length).toBe(.997);
  expect(merged.some(s => s.x - s.length / 2 < 2 && s.x + s.length / 2 > 2)).toBe(false);
  expect(simplifyMasonry([stone, { ...stone, y: 1.5 }], .003)[0]!.height).toBeCloseTo(1.997);
});

it('reduces all house materials at both levels without changing openings, glass or the useful envelope', () => {
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, bezierCurveTo() {}, ellipse() {} }; }
  });
  const engine = new NullEngine(), scene = new Scene(engine), kit = new TimberThatch(scene);
  try {
    for (const recipe of [HOUSE_RECIPE, LOG_HOUSE_RECIPE, BEAM_HOUSE_RECIPE, HALL_RECIPE])
      for (const phase of ['finished', 'works'] as const) {
        const cells=recipe===HALL_RECIPE?[{cellX:0,cellY:0},{cellX:0,cellY:1}]:[{cellX:0,cellY:0}];
        const plan = buildingPlan({id:'test',anchor:cells[0]!,cells,world:{widthCells:32,heightCells:32},recipe,phase});
        const roots = [0, 1, 2].map(lod => { kit.lod = lod as 0 | 1 | 2; const root = new Mesh(`lod-${lod}`,scene); kit.build(root,plan); return root; });
        const counts = roots.map(root => root.getChildMeshes().reduce((sum,m) => sum+m.getTotalVertices(),0));
        expect(counts[1]).toBeLessThan(counts[0]!); expect(counts[2]).toBeLessThan(counts[1]!);
        const near = roots[0]!.getHierarchyBoundingVectors(true);
        const glass = (root: Mesh) => root.getChildMeshes().filter(m=>m.metadata?.buildingAttachment==='glass').reduce((sum,m)=>sum+m.getTotalVertices(),0);
        for (const root of roots.slice(1)) {
          const bounds = root.getHierarchyBoundingVectors(true);
          for (const axis of ['x','y','z'] as const) {
            expect(Math.abs(bounds.min[axis]-near.min[axis])).toBeLessThan(.04);
            expect(Math.abs(bounds.max[axis]-near.max[axis])).toBeLessThan(.04);
          }
          expect(glass(root)).toBe(glass(roots[0]!));
        }
        for (const root of roots) root.dispose(false,false);
      }
  } finally { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); }
});

it('reduces every campus recipe while retaining its bounds, glass, material identities and construction state', () => {
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, bezierCurveTo() {}, ellipse() {} }; }
  });
  const engine = new NullEngine(), scene = new Scene(engine), kit = new TimberThatch(scene);
  const describe = (root: Mesh) => {
    root.computeWorldMatrix(true); for (const m of root.getChildMeshes()) m.computeWorldMatrix(true);
    const meshes = root.getChildMeshes().filter(m => m.getTotalVertices());
    return { meshes, bounds: root.getHierarchyBoundingVectors(), vertices: meshes.reduce((sum, m) => sum + m.getTotalVertices(), 0),
      glass: meshes.filter(m => m.metadata?.buildingAttachment === 'glass').reduce((sum, m) => sum + m.getTotalVertices(), 0),
      materials: [...new Set(meshes.map(m => m.material?.name))].sort() };
  };
  try {
    for (const phase of ['works', 'finished'] as const) for (const level of [1, 2, 3]) {
      const near = new Mesh('near', scene), far = new Mesh('far', scene);
      kit.distantMasonry = false; buildUniversity(near, kit, level, phase, level - 1, { mathematics: false, astronomy: false });
      kit.distantMasonry = true; buildUniversity(far, kit, level, phase, level - 1, { mathematics: false, astronomy: false });
      batchDistantBuilding(far);
      const a = describe(near), b = describe(far);
      expect(b.meshes.length).toBeLessThanOrEqual(8); expect(b.vertices).toBeLessThan(a.vertices * .7);
      expect(b.materials).toEqual(a.materials); expect(b.glass).toBe(a.glass);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(b.bounds.min[axis]).toBeCloseTo(a.bounds.min[axis], 5);
        expect(b.bounds.max[axis]).toBeCloseTo(a.bounds.max[axis], 5);
      }
      expect(b.meshes.every(m => m.subMeshes.length === 1 && scene.materials.includes(m.material!))).toBe(true);
      near.dispose(false, false); far.dispose(false, false);
    }
  } finally { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); }
});
