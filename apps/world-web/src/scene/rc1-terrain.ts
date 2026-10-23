import { triangleHeight, RC1_WORLD, type TerrainChunk } from '@arbestra/contracts';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { atlasUv, grassVariant } from './terrain-palette';
import type { Scene } from '@babylonjs/core/scene';
import type { WorldSpace } from './world-space';
import { TERRAIN_STREAMING } from './terrain-settings';
export function rc1Height(
  chunk: Pick<TerrainChunk, 'originCellX' | 'originCellY' | 'rc1'>,
  x: number,
  y: number,
): number | null {
  const p = chunk.rc1;
  if (!p) return null;
  const { widthCells: w, heightCells: h } = RC1_WORLD;
  const cellX = ((Math.round(x) % w) + w) % w,
    cellY = ((Math.round(y) % h) + h) % h;
  const terrace = p.terraces.find((t) => t.cellX === cellX && t.cellY === cellY);
  if (terrace) return terrace.height * 2.5;
  const resolution = p.model === 'vertices' ? 1 : 2;
  const a = (x - chunk.originCellX + 0.5) * resolution,
    b = (y - chunk.originCellY + 0.5) * resolution,
    ix = Math.max(0, Math.min(p.stride - 2, Math.floor(a))),
    iy = Math.max(0, Math.min(p.stride - 2, Math.floor(b))),
    u = a - ix,
    v = b - iy;
  const at = (dx: number, dy: number) => p.heights[(iy + dy) * p.stride + ix + dx]!;
  return triangleHeight(at(0, 0), at(1, 0), at(1, 1), at(0, 1), u, v) * 2.5;
}
export function buildRc1TerrainUnit(
  scene: Scene,
  chunk: TerrainChunk,
  offsetX: number,
  offsetY: number,
  space: WorldSpace,
  groundMaterial: StandardMaterial,
  waterMaterial: StandardMaterial,
): Mesh[] {
  const patch = chunk.rc1!,
    resolution = patch.model === 'vertices' ? 1 : 2,
    size = (patch.stride - 1) / resolution,
    unit = TERRAIN_STREAMING.renderUnitCells,
    origin = space.project({ cellX: chunk.originCellX, cellY: chunk.originCellY });
  const positions: number[] = [],
    indices: number[] = [],
    colors: number[] = [],
    waterPositions: number[] = [],
    waterIndices: number[] = [],
    uvs: number[] = [],
    groundUvs: number[] = [];
  const terrace = new Map(patch.terraces.map((t) => [t.cellX + ':' + t.cellY, t.height]));
  type V = { x: number; y: number; h: number; w: number };
  const triangle = (vs: V[], water = false, tile = 24, cellX = 0, cellY = 0) => {
    const pos = water ? waterPositions : positions,
      idx = water ? waterIndices : indices,
      start = pos.length / 3;
    for (const v of vs) {
      pos.push(origin.x + v.x * 2.5, (water ? v.w + 0.006 : v.h) * 2.5, origin.z + v.y * 2.5);
      if (water) uvs.push((chunk.originCellX + v.x) / 5, (chunk.originCellY + v.y) / 5);
      else {
        const shore = Math.abs(v.h - v.w) < 0.08;
        colors.push(...(shore ? [0.8, 0.75, 0.6, 1] : [1, 1, 1, 1]));
        groundUvs.push(...atlasUv(tile, v.x - cellX + 0.5, v.y - cellY + 0.5));
      }
    }
    idx.push(start, start + 1, start + 2);
  };
  for (let y = offsetY; y < Math.min(size, offsetY + unit); y++)
    for (let x = offsetX; x < Math.min(size, offsetX + unit); x++) {
      const level = terrace.get(chunk.originCellX + x + ':' + (chunk.originCellY + y));
      const vertex = (dx: number, dy: number): V => ({
        x: x - 0.5 + dx / resolution,
        y: y - 0.5 + dy / resolution,
        h: level ?? patch.heights[(y * resolution + dy) * patch.stride + x * resolution + dx]!,
        w: patch.water[(y * resolution + dy) * patch.stride + x * resolution + dx]!,
      });
      for (let sy = 0; sy < resolution; sy++)
        for (let sx = 0; sx < resolution; sx++)
          for (const vs of [
            [vertex(sx, sy), vertex(sx + 1, sy), vertex(sx + 1, sy + 1)],
            [vertex(sx, sy), vertex(sx + 1, sy + 1), vertex(sx, sy + 1)],
          ]) {
            triangle(vs, false, grassVariant(chunk.originCellX + x, chunk.originCellY + y), x, y);
            const wet: V[] = [];
            for (let i = 0; i < 3; i++) {
              const a = vs[i]!,
                b = vs[(i + 1) % 3]!,
                da = a.w - a.h,
                db = b.w - b.h;
              if (da > 0) wet.push(a);
              if (da > 0 !== db > 0) {
                const t = da / (da - db);
                wet.push({
                  x: a.x + (b.x - a.x) * t,
                  y: a.y + (b.y - a.y) * t,
                  h: a.h + (b.h - a.h) * t,
                  w: a.w + (b.w - a.w) * t,
                });
              }
            }
            for (let i = 1; i < wet.length - 1; i++) triangle([wet[0]!, wet[i]!, wet[i + 1]!], true);
          }
      if (level !== undefined)
        for (const [ax, ay, bx, by] of [
          [0, 0, 2, 0],
          [2, 0, 2, 2],
          [2, 2, 0, 2],
          [0, 2, 0, 0],
        ]) {
          const a = vertex(ax!, ay!),
            b = vertex(bx!, by!),
            c = { ...b, h: patch.heights[(y * 2 + by!) * patch.stride + x * 2 + bx!]! },
            d = { ...a, h: patch.heights[(y * 2 + ay!) * patch.stride + x * 2 + ax!]! };
          triangle([a, b, c], false, 24, x, y);
          triangle([a, c, d], false, 24, x, y);
        }
    }
  const make = (name: string, pos: number[], idx: number[], mat: StandardMaterial) => {
    const mesh = new Mesh(name, scene),
      v = new VertexData(),
      normals: number[] = [];
    VertexData.ComputeNormals(pos, idx, normals);
    v.positions = pos;
    v.indices = idx;
    v.normals = normals;
    if (name === 'rc1-ground-unit') {
      v.colors = colors;
      v.uvs = groundUvs;
    } else v.uvs = uvs;
    v.applyToMesh(mesh);
    mesh.material = mat;
    mesh.receiveShadows = true;
    mesh.isPickable = false;
    return mesh;
  };
  return [
    make('rc1-ground-unit', positions, indices, groundMaterial),
    ...(waterIndices.length ? [make('rc1-water-unit', waterPositions, waterIndices, waterMaterial)] : []),
  ];
}
