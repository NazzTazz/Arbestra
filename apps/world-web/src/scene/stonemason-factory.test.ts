import { expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { TimberThatch } from './timber-thatch';
import { buildStonemason } from './stonemason-factory';

it('keeps both phases inside four cells and releases owned resources while preserving the shared kit', () => {
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, bezierCurveTo() {}, ellipse() {}, putImageData() {} }; }
  });
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray;
    constructor(width: number, height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
  });
  const engine = new NullEngine(), scene = new Scene(engine), kit = new TimberThatch(scene);
  const sharedMaterials = [...scene.materials];
  try {
    const vertices: number[] = [];
    for (const phase of ['works', 'finished'] as const) for (let turn = 0; turn < 4; turn++) {
      const root = new Mesh('workshop', scene); root.rotation.y = turn * Math.PI / 2;
      buildStonemason(root, kit, phase);
      const meshes = root.getChildMeshes().filter(m => m.getTotalVertices() > 0);
      const roofMeshes = meshes.filter(m => m.parent?.name === 'stonemason-canopy');
      expect(roofMeshes.length).toBeGreaterThan(0);
      expect(roofMeshes.every(m => m.material !== kit.stone && m.material !== kit.hay)).toBe(true);
      expect(roofMeshes.some(m => m.material === kit.boards)).toBe(phase === 'finished');
      expect(meshes.length).toBeLessThanOrEqual(9);
      expect(scene.particleSystems).toHaveLength(phase === 'finished' ? 1 : 0);
      expect(scene.lights).toHaveLength(phase === 'finished' ? 1 : 0);
      vertices.push(meshes.reduce((n, m) => n + m.getTotalVertices(), 0));
      for (const mesh of meshes) {
        expect(mesh.isPickable).toBe(false); mesh.computeWorldMatrix(true);
        if (mesh.material?.name === 'stonemason-yard-earth') {
          const normals: number[] = [];
          VertexData.ComputeNormals(mesh.getVerticesData('position')!, mesh.getIndices()!, normals);
          expect(normals.filter((_, i) => i % 3 === 1).every(y => y > .99)).toBe(true);
        }
        const box = mesh.getBoundingInfo().boundingBox;
        for (const axis of ['x', 'z'] as const) {
          expect(box.minimumWorld[axis]).toBeGreaterThanOrEqual(-2.5);
          expect(box.maximumWorld[axis]).toBeLessThanOrEqual(2.5);
        }
      }
      if (phase === 'finished' && turn === 0) for (const side of [-1, 1]) {
        const throughSide = (y: number, z = .83) => scene.pickWithRay(
          new Ray(new Vector3(side * 2.2, y, z), new Vector3(-side, 0, 0), .65),
          mesh => mesh.material === kit.stone,
        )?.hit;
        expect(throughSide(1.3)).toBe(false); // The opening is actual empty geometry.
        expect(throughSide(1.9)).toBe(true); // Cut-stone arch above it.
        for (const z of [.62, .8, .98]) expect(throughSide(2.06, z)).toBe(true);
        expect(throughSide(2.15)).toBe(true); // Masonry fills the wall up to the roof.
      }
      root.dispose(false, false);
      expect(scene.meshes).toHaveLength(0);
      expect(scene.particleSystems).toHaveLength(0);
      expect(scene.lights).toHaveLength(0);
      expect(scene.materials).toEqual(sharedMaterials);
    }
    expect(vertices[4]).toBeGreaterThan(vertices[0]!);
  } finally { scene.dispose(); engine.dispose(); vi.unstubAllGlobals(); }
});
