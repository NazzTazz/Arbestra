import {buildRc1TerrainUnit} from './rc1-terrain';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh as BabylonMesh, type Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { TerrainChunk } from '@arbestra/contracts';
import { needsDiagonalShorePatch, shoreFaceCorners, shoreInset } from './shore-profile';
import { normalize, WorldSpace } from './world-space';
import { TERRAIN_STREAMING } from './terrain-settings';
import { ROAD_DEPTH, roadTileRects, roadTileBorders } from './road-profile';
import type {RoadPixel} from '@arbestra/contracts';
const TILE_SIZE = 2.5;
export const RENDER_UNIT_CELLS = TERRAIN_STREAMING.renderUnitCells;
export function hash(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
export function buildTerrainUnit(scene: Scene, chunk: TerrainChunk, offsetX: number, offsetY: number,
  space: WorldSpace, material: StandardMaterial, waterMaterial: StandardMaterial,
  roads: ReadonlyMap<string, number> = new Map(), infrastructure:ReadonlyMap<string,RoadPixel>=new Map()): Mesh[] {
  if(chunk.rc1)return buildRc1TerrainUnit(scene,chunk,offsetX,offsetY,space,waterMaterial);
  const size = Math.sqrt(chunk.terrainCodes.length) - 2, stride = size + 2;
  const origin = space.project({ cellX: chunk.originCellX, cellY: chunk.originCellY });
  const result: Mesh[] = [];
    const waterColors = ['#426b72', '#49747a', '#527b80', '#456e75'].map((color) => Color3.FromHexString(color));
    const stoneColors = ['#696b59', '#747362', '#606756'].map((color) => Color3.FromHexString(color));
    const earthSide = Color3.FromHexString('#51442c');
    const white = Color3.White();
    const waterLevel = -0.75;
    const waterPositions: number[] = [];
    const waterIndices: number[] = [];
    const waterUvs: number[] = [];
    const terrainAt = (x: number, y: number): { code: number; height: number } | null => {
      if (x < 0 || y < 0 || x >= stride || y >= stride) return null;
      const index = y * stride + x;
      const code = chunk.terrainCodes[index] ?? 1;
      return { code, height: code === 2 ? waterLevel : (chunk.elevations[index] ?? 0) * 0.025 };
    };

    {
      {
        const positions: number[] = [];
        const indices: number[] = [];
        const normals: number[] = [];
        const colors: number[] = [];
        const uvs: number[] = [];
        const quad = (corners: number[], color: Color3, tileIndex = 24): void => {
          const first = positions.length / 3;
          positions.push(...corners);
          indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
          for (let vertex = 0; vertex < 4; vertex += 1) colors.push(color.r, color.g, color.b, 1);
          const column = tileIndex % 8, row = Math.floor(tileIndex / 8);
          const u0 = column / 8 + 0.5 / 1024, u1 = (column + 1) / 8 - 0.5 / 1024;
          const v0 = row / 4 + 0.5 / 512, v1 = (row + 1) / 4 - 0.5 / 512;
          uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);
        };
        for (let localX = 0; localX < Math.min(RENDER_UNIT_CELLS, size - offsetX); localX += 1) {
          for (let localY = 0; localY < Math.min(RENDER_UNIT_CELLS, size - offsetY); localY += 1) {
            const regionX = offsetX + localX + 1;
            const regionY = offsetY + localY + 1;
            const worldCellX = normalize(chunk.originCellX + regionX - 1, space.width);
            const worldCellY = normalize(chunk.originCellY + regionY - 1, space.height);
            const centerX = origin.x + (regionX - 1) * TILE_SIZE;
            const centerZ = origin.z + (regionY - 1) * TILE_SIZE;
            const current = terrainAt(regionX, regionY)!;
            const north = terrainAt(regionX, regionY - 1);
            const east = terrainAt(regionX + 1, regionY);
            const south = terrainAt(regionX, regionY + 1);
            const west = terrainAt(regionX - 1, regionY);
            const byCell = hash(worldCellX, worldCellY);
            const byPatch = hash(Math.floor(worldCellX / 5), Math.floor(worldCellY / 5));
            const palette = current.code === 2 ? waterColors : stoneColors;
            const variant = Math.floor(((byCell * 0.65 + byPatch * 0.35) % 1) * (current.code === 1 ? 8 : palette.length));
            const color = current.code === 0 ? Color3.FromHexString('#535563') : current.code === 1 ? white : palette[variant]!;
            const left = centerX - TILE_SIZE / 2, right = centerX + TILE_SIZE / 2;
            const back = centerZ - TILE_SIZE / 2, front = centerZ + TILE_SIZE / 2;
            const top = current.height;
            const road = current.code === 1 ? roads.get(`${worldCellX}:${worldCellY}`) : undefined;
            const edited=infrastructure.has(`cell:${worldCellX}:${worldCellY}`);
            if(edited){
              for(let iy=0;iy<16;iy++){let start=0;
                const dug=(ix:number)=>{const px=((worldCellX*16-8+ix)%(space.width*16)+space.width*16)%(space.width*16),py=((worldCellY*16-8+iy)%(space.height*16)+space.height*16)%(space.height*16);
                  const p=infrastructure.get(`${px}:${py}`);return Boolean(p?.manual&&p.material!=='none');};
                for(let ix=1;ix<=16;ix++)if(ix===16||dug(ix)!==dug(start)){
                  const excavated=dug(start),y=top-(excavated?ROAD_DEPTH:0),x0=left+start*TILE_SIZE/16,x1=left+ix*TILE_SIZE/16,z0=back+iy*TILE_SIZE/16,z1=z0+TILE_SIZE/16;
                  quad([x0,y,z0,x1,y,z0,x1,y,z1,x0,y,z1],excavated?earthSide:color,excavated?24:variant);start=ix;
                }
              }
            }else if (road === undefined) {
              quad([left, top, back, right, top, back, right, top, front, left, top, front], color,
                current.code === 1 ? variant : 24);
            } else {
              for (const r of roadTileRects(road)) {
                const y = top - (r.dug ? ROAD_DEPTH : 0);
                quad([centerX+r.x0,y,centerZ+r.z0, centerX+r.x1,y,centerZ+r.z0,
                  centerX+r.x1,y,centerZ+r.z1, centerX+r.x0,y,centerZ+r.z1], r.dug ? earthSide : color, r.dug ? 24 : variant);
              }
              for (const e of roadTileBorders(road)) {
                quad([centerX+e.x0,top,centerZ+e.z0, centerX+e.x1,top,centerZ+e.z1,
                  centerX+e.x1,top-ROAD_DEPTH,centerZ+e.z1, centerX+e.x0,top-ROAD_DEPTH,centerZ+e.z0], earthSide);
              }
            }
            if (current.code === 2) {
              const first = waterPositions.length / 3;
              const surface = waterLevel + 0.012;
              waterPositions.push(left, surface, back, right, surface, back,
                right, surface, front, left, surface, front);
              waterIndices.push(first, first + 1, first + 2, first, first + 2, first + 3);
              const u = worldCellX / 5, v = worldCellY / 5, span = 1 / 5;
              waterUvs.push(u, v, u + span, v, u + span, v + span, u, v + span);
              continue;
            }
            const edges = [
              { neighbor: north, a: [left, back], b: [right, back], outward: [0, -1] },
              { neighbor: east, a: [right, back], b: [right, front], outward: [1, 0] },
              { neighbor: south, a: [right, front], b: [left, front], outward: [0, 1] },
              { neighbor: west, a: [left, front], b: [left, back], outward: [-1, 0] },
            ];
            for (const [edgeIndex, edge] of edges.entries()) {
              if (!edge.neighbor || top <= edge.neighbor.height + 0.025) continue;
              if (edge.neighbor.code === 2) {
                const points = Array.from({ length: 5 }, (_, point) => {
                  const fraction = point / 4;
                  const alongX = edge.a[0]! + (edge.b[0]! - edge.a[0]!) * fraction;
                  const alongZ = edge.a[1]! + (edge.b[1]! - edge.a[1]!) * fraction;
                  const inset = shoreInset(worldCellX, worldCellY, edgeIndex, point);
                  return {
                    outerX: alongX,
                    outerZ: alongZ,
                    innerX: alongX - edge.outward[0]! * inset,
                    innerZ: alongZ - edge.outward[1]! * inset,
                  };
                });
                for (let point = 0; point < 4; point += 1) {
                  const a = points[point]!, b = points[point + 1]!;
                  const lip = top + 0.028;
                  quad([a.outerX, lip, a.outerZ, b.outerX, lip, b.outerZ,
                    b.innerX, lip, b.innerZ, a.innerX, lip, a.innerZ], white, 25);
                  quad(shoreFaceCorners([a.outerX, a.outerZ], [b.outerX, b.outerZ], lip, waterLevel - 0.015), white, 26);
                }
                continue;
              }
              const bottom = edge.neighbor.height;
              quad([
                edge.a[0]!, top, edge.a[1]!, edge.b[0]!, top, edge.b[1]!,
                edge.b[0]!, bottom, edge.b[1]!, edge.a[0]!, bottom, edge.a[1]!,
              ], earthSide);
            }
            const waterEdges = [north, east, south, west].map((neighbor) => neighbor?.code === 2);
            const corners = [
              { x: left, z: back, edges: [0, 3], insetX: 1, insetZ: 1, diagonal: terrainAt(regionX - 1, regionY - 1) },
              { x: right, z: back, edges: [0, 1], insetX: -1, insetZ: 1, diagonal: terrainAt(regionX + 1, regionY - 1) },
              { x: right, z: front, edges: [1, 2], insetX: -1, insetZ: -1, diagonal: terrainAt(regionX + 1, regionY + 1) },
              { x: left, z: front, edges: [2, 3], insetX: 1, insetZ: -1, diagonal: terrainAt(regionX - 1, regionY + 1) },
            ];
            for (const corner of corners) {
              const farX = corner.x + corner.insetX * 0.38;
              const farZ = corner.z + corner.insetZ * 0.38;
              const cap = top + 0.032;
              if (waterEdges[corner.edges[0]!] && waterEdges[corner.edges[1]!]) {
                const minX = Math.min(corner.x, farX), maxX = Math.max(corner.x, farX);
                const minZ = Math.min(corner.z, farZ), maxZ = Math.max(corner.z, farZ);
                quad([minX, cap, minZ, maxX, cap, minZ,
                  maxX, cap, maxZ, minX, cap, maxZ], white, 25);
              } else if (current.code === 1 && needsDiagonalShorePatch(
                edges[corner.edges[0]!]!.neighbor?.code ?? null,
                edges[corner.edges[1]!]!.neighbor?.code ?? null,
                corner.diagonal?.code ?? null,
              )) {
                const a = [corner.x, corner.z], b = [farX, corner.z], c = [corner.x, farZ];
                const forward = corner.insetX * corner.insetZ > 0;
                const second = forward ? b : c, third = forward ? c : b;
                quad([a[0]!, cap, a[1]!, second[0]!, cap, second[1]!,
                  third[0]!, cap, third[1]!, third[0]!, cap, third[1]!], white, 25);
              }
            }
          }
        }
        VertexData.ComputeNormals(positions, indices, normals);
        const data = new VertexData();
        data.positions = positions;
        data.indices = indices;
        data.normals = normals;
        data.colors = colors;
        data.uvs = uvs;
        const mesh = new BabylonMesh(`generated-terrain-${chunk.chunkX}-${chunk.chunkY}`, scene);
        data.applyToMesh(mesh);
        mesh.material = material;
        mesh.receiveShadows = true;
        mesh.isPickable = false;
        result.push(mesh);
      }
    }
    if (waterIndices.length) {
      const overlay = new BabylonMesh('water-ripple-overlay', scene);
      const data = new VertexData();
      data.positions = waterPositions;
      data.indices = waterIndices;
      data.uvs = waterUvs;
      data.normals = Array.from({ length: waterPositions.length / 3 }, () => [0, 1, 0]).flat();
      data.applyToMesh(overlay, true);
      overlay.material = waterMaterial;
      overlay.isPickable = false;
      result.push(overlay);
    }
  return result;
}
