import { Type, type Static } from '@sinclair/typebox';
import { LevelingQuoteSchema, LevelingPreviewSchema, type LevelingQuote } from './leveling.js';
import { footprintVertices, vertexLeveling } from './terrain-vertices.js';
import type { SpatialDimensions } from './building-footprint.js';

export const MAX_TERRAFORM_CELLS = 256;
const Cell = Type.Object(
  { cellX: Type.Integer({ minimum: 0 }), cellY: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);
export const TerraformRequestSchema = Type.Object(
  {
    buildingType: Type.Literal('terrain'),
    anchor: Cell,
    quarterTurns: Type.Literal(0),
    cells: Type.Array(Cell, { minItems: 1, maxItems: MAX_TERRAFORM_CELLS }),
    height: Type.Number({ multipleOf: 0.25 }),
    workerCount: Type.Integer({ minimum: 1, maximum: 50 }),
  },
  { additionalProperties: false },
);
export const TerraformCommandSchema = Type.Object(
  { ...TerraformRequestSchema.properties, commandId: Type.String({ format: 'uuid' }), expected: LevelingQuoteSchema },
  { additionalProperties: false },
);
export const TerraformChangedSchema = Type.Object({ status: Type.Literal('changed'), preview: LevelingPreviewSchema });
export type TerraformRequest = Static<typeof TerraformRequestSchema>;
export type TerraformCommand = Static<typeof TerraformCommandSchema>;
export function terraformCells(request: TerraformRequest, world: SpatialDimensions) {
  if (
    !request.cells.length ||
    request.cells.length > MAX_TERRAFORM_CELLS ||
    !Number.isSafeInteger(request.height * 4) ||
    !Number.isInteger(request.workerCount) ||
    request.workerCount < 1 ||
    request.workerCount > 50
  )
    throw Error('Invalid terrain selection');
  const cells = [
    ...new Map(
      request.cells.map((c) => {
        if (
          !Number.isInteger(c.cellX) ||
          !Number.isInteger(c.cellY) ||
          c.cellX < 0 ||
          c.cellY < 0 ||
          c.cellX >= world.widthCells ||
          c.cellY >= world.heightCells
        )
          throw Error('Invalid terrain coordinates');
        return [`${c.cellX}:${c.cellY}`, { ...c }] as const;
      }),
    ).values(),
  ].sort((a, b) => a.cellX - b.cellX || a.cellY - b.cellY);
  if (!cells.some((c) => c.cellX === request.anchor.cellX && c.cellY === request.anchor.cellY))
    throw Error('Missing terrain origin');
  return cells;
}
/** Identical local/server volume and price. Transport is estimated locally and
 * certified at admission; travel-only changes within 10% of the estimated total
 * duration are accepted using the server duration, otherwise another click is required. */
export function terraformQuote(
  request: TerraformRequest,
  world: SpatialDimensions,
  heightAt: (x: number, y: number) => number,
  transportMs: number,
): LevelingQuote {
  const cells = terraformCells(request, world),
    plan = vertexLeveling(cells, world, heightAt, request.workerCount, request.height);
  const source = footprintVertices(plan.affectedCells, world).map((v) => [
    v.vertexX,
    v.vertexY,
    heightAt(v.vertexX, v.vertexY),
  ]);
  if (source.some((p) => !Number.isFinite(p[2])) || !Number.isSafeInteger(transportMs) || transportMs < 0)
    throw Error('Terrain heights unavailable');
  const durationMs = plan.workMs + transportMs * 2;
  if (!Number.isSafeInteger(durationMs) || durationMs > 8.64e15) throw Error('Terrain work duration out of range');
  return {
    model: 'vertices',
    height: plan.height,
    cells,
    vertices: plan.vertices,
    affectedCells: plan.affectedCells,
    workMs: plan.workMs,
    transportMs,
    durationMs,
    stoneDebit: 0,
    stoneCredit: 0,
    signature: JSON.stringify([world.widthCells, world.heightCells, source]),
  };
}
