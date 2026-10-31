import {
  fixedBuildingFootprint,
  footprintVertices,
  vertexLeveling,
  infrastructurePlanSurface,
  infrastructureSidewalkSurface,
  spawnDelta,
  terraformQuote,
  triangleHeight,
  type TerraformRequest,
  type VillageState,
} from '@arbestra/contracts';
import type { TerraformVisual } from '../scene/terraform-preview';
const infrastructureObstacles = new WeakMap<NonNullable<VillageState['infrastructure']>, Set<string>>();
function protectedInfrastructure(state: VillageState) {
  const plan = state.infrastructure;
  if (!plan) return new Set<string>();
  const cached = infrastructureObstacles.get(plan);
  if (cached) return cached;
  const blocked = new Set<string>(),
    world = state.world;
  const key = (x: number, y: number) =>
    `${((Math.floor(x + 0.5) % world.widthCells) + world.widthCells) % world.widthCells}:${((Math.floor(y + 0.5) % world.heightCells) + world.heightCells) % world.heightCells}`;
  for (const e of plan.equipment) blocked.add(key(e.x / 8, e.y / 8));
  const surface = infrastructurePlanSurface(plan, world);
  for (const p of surface.values()) if (p.manual) blocked.add(key((p.x + 0.5) / 16, (p.y + 0.5) / 16));
  for (const p of infrastructureSidewalkSurface(surface, world).values())
    blocked.add(key((p.x + 0.5) / 16, (p.y + 0.5) / 16));
  infrastructureObstacles.set(plan, blocked);
  return blocked;
}
export function villageVertexHeight(state: VillageState, x: number, y: number) {
  const r = state.region,
    world = state.world,
    dx = (x - r.originCellX + world.widthCells) % world.widthCells,
    dy = (y - r.originCellY + world.heightCells) % world.heightCells;
  return r.vertexHeights && dx <= r.width && dy <= r.height ? (r.vertexHeights[dy * (r.width + 1) + dx] ?? NaN) : NaN;
}
export function terrainBrushHeight(
  state: VillageState,
  x: number,
  y: number,
  heightAt = (x: number, y: number) => villageVertexHeight(state, x, y),
) {
  const ix = Math.floor(x + 0.5),
    iy = Math.floor(y + 0.5),
    height = (dx: number, dy: number) =>
      heightAt((ix + dx) % state.world.widthCells, (iy + dy) % state.world.heightCells);
  return (
    Math.round(triangleHeight(height(0, 0), height(1, 0), height(1, 1), height(0, 1), x + 0.5 - ix, y + 0.5 - iy) * 4) /
    4
  );
}
/** Immediate brush feedback uses only painted corners; never waits for a quote or its ring. */
export function terraformSelectionVisual(
  request: TerraformRequest,
  world: VillageState['world'],
  heightAt: (x: number, y: number) => number,
): TerraformVisual {
  const sourceHeights = footprintVertices(request.cells, world).map((v) => ({
    ...v,
    height: heightAt(v.vertexX, v.vertexY),
  }));
  const vertices = sourceHeights.map((v) => ({ ...v, height: request.height }));
  return {
    origin: request.anchor,
    invalidCells: [],
    sourceHeights,
    quote: {
      model: 'vertices',
      height: request.height,
      cells: request.cells,
      affectedCells: request.cells,
      vertices,
      workMs: 1,
      transportMs: 0,
      durationMs: 1,
      stoneDebit: 0,
      stoneCredit: 0,
      signature: '',
    },
  };
}
export function localTerraform(
  state: VillageState,
  request: TerraformRequest,
  heightAt = (x: number, y: number) => villageVertexHeight(state, x, y),
): { visual: TerraformVisual; error: string | null } {
  const travel = Math.ceil(
    Math.max(
      0,
      Math.min(
        ...request.cells.map((c) =>
          Math.hypot(
            spawnDelta(c.cellX, state.village.anchorCellX, state.world.widthCells),
            spawnDelta(c.cellY, state.village.anchorCellY, state.world.heightCells),
          ),
        ),
      ) - 1,
    ) * 1000,
  );
  const quote = terraformQuote(request, state.world, heightAt, travel);
  const free = new Set(state.cells.filter((c) => c.canBuild).map((c) => `${c.cellX}:${c.cellY}`));
  const protectedCells = protectedInfrastructure(state);
  const invalidCells = quote.affectedCells!.filter(
    (c) => !free.has(`${c.cellX}:${c.cellY}`) || protectedCells.has(`${c.cellX}:${c.cellY}`),
  );
  const sourceHeights = footprintVertices(quote.affectedCells!, state.world).map((v) => ({
    ...v,
    height: heightAt(v.vertexX, v.vertexY),
  }));
  const noChange = quote.vertices!.every((v) => Math.abs(v.height - heightAt(v.vertexX, v.vertexY)) < 1e-9);
  const error = invalidCells.length
    ? 'Une case ou son raccord est occupé, protégé ou hors de portée.'
    : request.height <= 0
      ? 'Cette hauteur ferait entrer l’eau.'
      : noChange
        ? 'Le terrain est déjà à cette hauteur.'
        : null;
  return { visual: { quote, origin: request.anchor, invalidCells, sourceHeights }, error };
}
/** One preview for a whole waiting batch: cells and rings joined, a shared
 * vertex at the height of the later gesture, source heights from the first. */
export function mergeTerraformVisuals(visuals: readonly TerraformVisual[]): TerraformVisual | null {
  if (!visuals.length) return null;
  if (visuals.length === 1) return visuals[0]!;
  const cellKey = (c: { cellX: number; cellY: number }) => `${c.cellX}:${c.cellY}`;
  const vertexId = (v: { vertexX: number; vertexY: number }) => `${v.vertexX}:${v.vertexY}`;
  const cells = new Map<string, { cellX: number; cellY: number }>(),
    affected = new Map<string, { cellX: number; cellY: number }>(),
    invalid = new Map<string, { cellX: number; cellY: number }>(),
    vertices = new Map<string, { vertexX: number; vertexY: number; height: number }>(),
    sources = new Map<string, { vertexX: number; vertexY: number; height: number }>();
  for (const visual of visuals) {
    for (const c of visual.quote.cells) cells.set(cellKey(c), c);
    for (const c of visual.quote.affectedCells ?? visual.quote.cells) affected.set(cellKey(c), c);
    for (const c of visual.invalidCells) invalid.set(cellKey(c), c);
    for (const v of visual.quote.vertices ?? []) vertices.set(vertexId(v), v);
    for (const v of visual.sourceHeights) if (!sources.has(vertexId(v))) sources.set(vertexId(v), v);
  }
  const last = visuals.at(-1)!;
  return {
    origin: last.origin,
    invalidCells: [...invalid.values()],
    sourceHeights: [...sources.values()],
    quote: {
      ...last.quote,
      cells: [...cells.values()],
      affectedCells: [...affected.values()],
      vertices: [...vertices.values()],
    },
  };
}
/** Preview of an instant footprint leveling (university, stonemason). */
export function footprintTerraformVisual(
  buildingType: 'university' | 'stonemason',
  anchor: { cellX: number; cellY: number },
  quarterTurns: number,
  world: VillageState['world'],
  heightAt: (x: number, y: number) => number,
): TerraformVisual {
  const cells = fixedBuildingFootprint(buildingType, anchor, quarterTurns, world);
  const plan = vertexLeveling(cells, world, heightAt, 1);
  return {
    origin: anchor,
    invalidCells: [],
    sourceHeights: footprintVertices(plan.affectedCells, world).map((v) => ({
      ...v,
      height: heightAt(v.vertexX, v.vertexY),
    })),
    quote: {
      model: 'vertices',
      height: plan.height,
      cells,
      affectedCells: plan.affectedCells,
      vertices: plan.vertices,
      workMs: 1,
      transportMs: 0,
      durationMs: 1,
      stoneDebit: 0,
      stoneCredit: 0,
      signature: '',
    },
  };
}
