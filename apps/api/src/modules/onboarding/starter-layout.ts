import { randomUUID } from 'node:crypto';
import { infrastructurePlanSurface, wrapCoordinate, type BuildingVisualLayout, type InfrastructurePlan } from '@arbestra/contracts';

export interface StarterVillageTemplate {
  version: 1;
  buildings: Array<{ type: string; level: number; quarterTurns: number; visualLayout: BuildingVisualLayout | null;
    cells: Array<{ x: number; y: number; role: 'anchor' | 'extension' | 'body' }> }>;
  infrastructure: InfrastructurePlan;
}

/** Used for export and spawn; all coordinates and lighting references follow the anchor. */
export function translateInfrastructure(plan: InfrastructurePlan, dx: number, dy: number,
  world?: { widthCells: number; heightCells: number }): InfrastructurePlan {
  const x = (n: number, scale = 1) => world ? wrapCoordinate(n + dx * scale, world.widthCells * scale) : n + dx * scale;
  const y = (n: number, scale = 1) => world ? wrapCoordinate(n + dy * scale, world.heightCells * scale) : n + dy * scale;
  const cell = (key: string) => { const [cx, cy] = key.split(':').map(Number); return `${x(cx!)}:${y(cy!)}`; };
  const roads = (items: InfrastructurePlan['roads']) => items.map(road => ({ ...road, id: randomUUID(),
    points: road.points.map(p => ({ x: x(p.x, 8), y: y(p.y, 8) })) }));
  return { revision: 0, stoneReserve: 0, roads: roads(plan.roads),
    inheritedRoads: roads(plan.inheritedRoads ?? []), inheritedCells: (plan.inheritedCells ?? []).map(cell),
    equipment: plan.equipment.map(item => ({ ...item, id: randomUUID(), version: 1, x: x(item.x, 8), y: y(item.y, 8) })),
    manualLighting: plan.manualLighting.map(cell), suppressedBraziers: plan.suppressedBraziers.map(id => {
      const parts = id.split(':');
      if (parts[0] !== 'auto' || ![5, 8].includes(parts.length)) throw Error('Unsupported starter lighting ID');
      parts[1] = String(x(Number(parts[1]))); parts[2] = String(y(Number(parts[2])));
      if (parts.length === 8) { parts[4] = String(x(Number(parts[4]), 8)); parts[5] = String(y(Number(parts[5]), 8)); }
      return parts.join(':');
    }) };
}
export function placeStarterVillage(template: StarterVillageTemplate, anchor: { x: number; y: number }, world: { widthCells: number; heightCells: number }) {
  const buildings = template.buildings.map(building => ({ ...building, id: randomUUID(),
    cells: building.cells.map(c => ({ cellX: wrapCoordinate(c.x + anchor.x, world.widthCells),
      cellY: wrapCoordinate(c.y + anchor.y, world.heightCells), role: c.role })) }));
  const infrastructure = translateInfrastructure(template.infrastructure, anchor.x, anchor.y, world);
  const required = new Map<string, { cellX: number; cellY: number }>();
  const add = (cellX: number, cellY: number) => { required.set(`${cellX}:${cellY}`, { cellX, cellY }); };
  for (const building of buildings) for (const c of building.cells) add(c.cellX, c.cellY);
  for (const pixel of infrastructurePlanSurface(infrastructure, world).values()) {
    if (pixel.material !== 'none' || pixel.border) add(wrapCoordinate(Math.floor((pixel.x + 8) / 16), world.widthCells), wrapCoordinate(Math.floor((pixel.y + 8) / 16), world.heightCells));
  }
  for (const item of infrastructure.equipment) add(wrapCoordinate(Math.floor((item.x + 4) / 8), world.widthCells), wrapCoordinate(Math.floor((item.y + 4) / 8), world.heightCells));
  return { buildings, infrastructure, required: [...required.values()] };
}
