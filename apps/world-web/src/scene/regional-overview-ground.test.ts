import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { TerrainOverview, TerrainVegetationOverview } from '@arbestra/contracts';
import {
  REGIONAL_GROUND_MARGIN,
  REGIONAL_GROUND_REFIT_MS,
  REGIONAL_GROUND_SAMPLE_BUDGET,
  REGIONAL_WATER_HEIGHT,
  RegionalOverview,
} from './terrain-overview-view';
import { WorldSpace } from './world-space';

/** A flat world whose regional means stand at elevation 20 (0.22 units). */
function fixture(center = 512, size = 1024) {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    grid = 64;
  const data = {
    world: { id: 'w', generationVersion: 3, widthCells: size, heightCells: size, chunkSize: 32 },
    gridWidth: grid,
    gridHeight: grid,
    meanElevations: new Array(grid * grid).fill(20),
    waterCoverage: new Array(grid * grid).fill(0),
    rockCoverage: new Array(grid * grid).fill(0),
  } as unknown as TerrainOverview;
  const overview = new RegionalOverview(scene),
    space = new WorldSpace(size, size, { cellX: 512 % size, cellY: 512 % size });
  overview.set(data);
  overview.update(space, { cellX: center, cellY: 512 });
  const heights = () => {
    const p = overview.mesh!.getVerticesData('position')!;
    return Array.from({ length: p.length / 3 }, (_, i) => ({ x: p[i * 3]!, y: p[i * 3 + 1]!, z: p[i * 3 + 2]! }));
  };
  return { overview, heights, data, space, dispose: () => (scene.dispose(), engine.dispose()) };
}

// Detailed ground streamed around the village (cells 480..544), with a hollow
// at 0.0 where the regional means (0.22) would cover it.
const land = (height: number) => ({ code: 1, height });
const streamed = (x: number, y: number) =>
  x >= 480 && x <= 544 && y >= 480 && y <= 544 ? land(Math.hypot(x - 512, y - 512) < 12 ? 0 : 0.6) : null;

it('sinks the regional sheet under the detailed ground wherever it is streamed, and only there', () => {
  const f = fixture();
  try {
    const before = f.heights();
    expect(Math.max(...before.map((v) => v.y))).toBeCloseTo(20 * 0.025 - 0.28);
    f.overview.fitGround(streamed, 1, 0);
    const after = f.heights();
    for (const [i, v] of after.entries()) {
      // Local units are 2.5 per cell around the origin cell 512.
      const cx = 512 + v.x / 2.5,
        cy = 512 + v.z / 2.5;
      const near = cx >= 472 && cx <= 552 && cy >= 472 && cy <= 552;
      if (near) expect(v.y).toBeLessThanOrEqual(0.6 - REGIONAL_GROUND_MARGIN + 1e-6);
      else expect(v.y).toBe(before[i]!.y);
    }
    // In the hollow, the sheet goes under the lowest detailed sample.
    const centre = after.reduce((a, b) => (Math.hypot(a.x, a.z) < Math.hypot(b.x, b.z) ? a : b));
    expect(centre.y).toBeLessThanOrEqual(0 - REGIONAL_GROUND_MARGIN + 1e-6);
  } finally {
    f.dispose();
  }
});

it('refits only when the ground changes, at most once per interval, and probes unstreamed blocks cheaply', () => {
  const f = fixture();
  try {
    f.overview.fitGround(streamed, 1, 0);
    const first = f.overview.groundSamples;
    // 80 × 80 blocks of 8 cells: five probes each where nothing is streamed,
    // a full 9 × 9 read only around the village.
    expect(first).toBeLessThan(80 * 80 * 5 + 120 * 81);
    f.overview.groundSamples = 0;
    f.overview.fitGround(streamed, 1, 5000);
    expect(f.overview.groundSamples).toBe(0); // same revision: nothing read
    f.overview.fitGround(streamed, 2, 500);
    expect(f.overview.groundSamples).toBe(0); // throttled
    f.overview.fitGround(streamed, 2, REGIONAL_GROUND_REFIT_MS + 1);
    expect(f.overview.groundSamples).toBe(first);
  } finally {
    f.dispose();
  }
});

it('sinks the sheet under a river bed too, so the real bed shows through the water', () => {
  const f = fixture();
  try {
    // Streamed water, its RC1 bed deep below the regional water height.
    f.overview.fitGround(
      (x, y) => (x >= 480 && x <= 544 && y >= 480 && y <= 544 ? { code: 2, height: -6 } : null),
      1,
      0,
    );
    expect(Math.min(...f.heights().map((v) => v.y))).toBeCloseTo(-6 - REGIONAL_GROUND_MARGIN, 5);
    expect(-6 - REGIONAL_GROUND_MARGIN).toBeLessThan(REGIONAL_WATER_HEIGHT);
  } finally {
    f.dispose();
  }
});

it('rereads only the blocks of the chunks a stroke changed, with the same sheet as a full refit (§7.14)', () => {
  const f = fixture(),
    full = fixture();
  try {
    // Detailed ground around the village, one revision per 32-cell chunk.
    const heights = new Map<string, number>();
    const revisions = new Map<string, number>();
    const height = (x: number, y: number) => heights.get(`${x}:${y}`) ?? (Math.hypot(x - 512, y - 512) < 12 ? 0 : 0.6);
    const ground = (x: number, y: number) => (x >= 480 && x <= 544 && y >= 480 && y <= 544 ? land(height(x, y)) : null);
    const revisionAt = (x: number, y: number) => revisions.get(`${Math.floor(x / 32)}:${Math.floor(y / 32)}`) ?? 0;
    f.overview.fitGround(ground, 1, 0, revisionAt);
    const first = f.overview.groundSamples;
    // A stroke lowers 3 cells of chunk 16:16: one refit reads that chunk's blocks only.
    for (const x of [520, 521, 522]) heights.set(`${x}:520`, -1);
    revisions.set('16:16', 1);
    f.overview.groundSamples = 0;
    f.overview.fitGround(ground, 2, REGIONAL_GROUND_REFIT_MS + 1, revisionAt);
    // At most the 6 × 6 blocks with a corner in the chunk, 5 probes and 81 samples each.
    expect(f.overview.groundSamples).toBeGreaterThan(0);
    expect(f.overview.groundSamples).toBeLessThanOrEqual(36 * 86);
    expect(f.overview.groundSamples).toBeLessThan(first / 4);
    // The same sheet as a full refit of the same ground.
    full.overview.fitGround(ground, 2, 0);
    expect(f.heights()).toEqual(full.heights());
    expect(Math.min(...f.heights().map((v) => v.y))).toBeCloseTo(-1 - REGIONAL_GROUND_MARGIN, 5);
    // Unchanged revisions: nothing read.
    f.overview.groundSamples = 0;
    f.overview.fitGround(ground, 3, 2 * REGIONAL_GROUND_REFIT_MS + 2, revisionAt);
    expect(f.overview.groundSamples).toBe(0);
  } finally {
    f.dispose();
    full.dispose();
  }
});

// Detailed ground in one 32-cell chunk revision each, around the village (cells 480..544).
const revisionAt = (x: number, y: number) =>
  x >= 480 && x <= 544 && y >= 480 && y <= 544 ? Math.floor(x / 32) * 100 + Math.floor(y / 32) : -1;

it('recolours the sheet in place when the vegetation comes back, without rereading the ground (§7.14)', () => {
  const f = fixture();
  try {
    f.overview.fitGround(streamed, 1, 0, revisionAt);
    const mesh = f.overview.mesh!,
      colours = Array.from(mesh.getVerticesData('color')!),
      heights = f.heights();
    // The 30 s refresh: same geography, dense woodland everywhere.
    const grid = f.data.gridWidth;
    f.overview.set(f.data, {
      world: f.data.world,
      gridWidth: grid,
      gridHeight: grid,
      woodlandCoverage: new Array(grid * grid).fill(255),
    } as unknown as TerrainVegetationOverview);
    f.overview.update(f.space, { cellX: 512, cellY: 512 });
    f.overview.fitGround(streamed, 1, 10, revisionAt);
    expect(f.overview.groundSamples).toBe(0);
    expect(f.overview.mesh).toBe(mesh);
    expect(f.heights()).toEqual(heights);
    expect(Array.from(mesh.getVerticesData('color')!)).not.toEqual(colours);
  } finally {
    f.dispose();
  }
});

// A world under 641 cells has a narrower sheet, still in whole 8-cell blocks (RC1 development).
it.each([1024, 512])(
  'keeps the mesh and the fitted blocks when the camera moves, reading only the blocks entering (%i cells, §7.14)',
  (size) => {
    const f = fixture(512, size),
      fresh = fixture(560, size);
    try {
      f.overview.fitGround(streamed, 1, 0, revisionAt);
      const mesh = f.overview.mesh!,
        first = f.overview.groundSamples;
      // 48 cells east: three 16-cell steps, six columns of 8-cell blocks enter the region.
      f.overview.update(f.space, { cellX: 560, cellY: 512 });
      f.overview.fitGround(streamed, 1, 10, revisionAt);
      expect(f.overview.groundSamples).toBeGreaterThan(0);
      expect(f.overview.groundSamples).toBeLessThanOrEqual(6 * 80 * 86);
      expect(f.overview.groundSamples).toBeLessThan(first / 4);
      expect(f.overview.mesh).toBe(mesh);
      // The same sheet as one laid out and fitted there from scratch.
      fresh.overview.fitGround(streamed, 1, 0, revisionAt);
      expect(f.heights()).toEqual(fresh.heights());
    } finally {
      f.dispose();
      fresh.dispose();
    }
  },
);

it('spreads a whole refit over frames within its sample budget, and costs O(1) once fitted (§7.14)', () => {
  const f = fixture(),
    full = fixture();
  try {
    full.overview.fitGround(streamed, 1, 0, revisionAt);
    const total = full.overview.groundSamples,
      budget = 2000;
    expect(total).toBeGreaterThan(4 * budget);
    expect(REGIONAL_GROUND_SAMPLE_BUDGET).toBeLessThan(total);
    let calls = 0,
      frames = 0,
      read = 0;
    const counted = (x: number, y: number) => (calls++, revisionAt(x, y));
    do {
      f.overview.fitGround(streamed, 1, frames, counted, budget);
      // One block may overshoot the budget: 5 probes and 9 × 9 samples.
      expect(f.overview.groundSamples).toBeLessThanOrEqual(budget + 86);
      read += f.overview.groundSamples;
      // Hidden until fitted, so its unfitted vertices never rise above the detailed ground.
      if (frames++ === 0) expect(f.overview.mesh!.isEnabled()).toBe(false);
    } while (f.overview.groundSamples > 0 && frames < 1000);
    expect(read).toBe(total);
    expect(frames).toBeGreaterThan(4);
    expect(f.heights()).toEqual(full.heights());
    expect(f.overview.mesh!.isEnabled()).toBe(true);
    // Fitted, same revision: no sample and no revision lookup.
    calls = 0;
    for (let frame = 0; frame < 100; frame++) f.overview.fitGround(streamed, 1, 5000 + frame, counted, budget);
    expect(calls).toBe(0);
    expect(f.overview.groundSamples).toBe(0);
  } finally {
    f.dispose();
    full.dispose();
  }
});
