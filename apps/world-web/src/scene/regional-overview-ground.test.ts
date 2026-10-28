import { expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import type { TerrainOverview } from '@arbestra/contracts';
import {
  REGIONAL_GROUND_MARGIN,
  REGIONAL_GROUND_REFIT_MS,
  REGIONAL_WATER_HEIGHT,
  RegionalOverview,
} from './terrain-overview-view';
import { WorldSpace } from './world-space';

/** A flat world whose regional means stand at elevation 20 (0.22 units). */
function fixture() {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    grid = 64;
  const data = {
    world: { id: 'w', generationVersion: 3, widthCells: 1024, heightCells: 1024, chunkSize: 32 },
    gridWidth: grid,
    gridHeight: grid,
    meanElevations: new Array(grid * grid).fill(20),
    waterCoverage: new Array(grid * grid).fill(0),
    rockCoverage: new Array(grid * grid).fill(0),
  } as unknown as TerrainOverview;
  const overview = new RegionalOverview(scene),
    space = new WorldSpace(1024, 1024, { cellX: 512, cellY: 512 });
  overview.set(data);
  overview.update(space, { cellX: 512, cellY: 512 });
  const heights = () => {
    const p = overview.mesh!.getVerticesData('position')!;
    return Array.from({ length: p.length / 3 }, (_, i) => ({ x: p[i * 3]!, y: p[i * 3 + 1]!, z: p[i * 3 + 2]! }));
  };
  return { overview, heights, dispose: () => (scene.dispose(), engine.dispose()) };
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
