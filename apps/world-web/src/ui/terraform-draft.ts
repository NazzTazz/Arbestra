import { triangleHeight, type VillageState } from '@arbestra/contracts';
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
