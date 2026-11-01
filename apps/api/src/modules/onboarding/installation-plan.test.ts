import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createSpawnTerrainField, type GeneratedLandscape, type SpawnMap } from '@arbestra/contracts';
import { planInstallation } from './installation-plan.js';
import { STARTER_KIT } from './starter-kit.js';

const landscape = JSON.parse(
  readFileSync(new URL('../../../../world-web/public/studies/t1-alpha512-rc1.json', import.meta.url), 'utf8'),
) as GeneratedLandscape;

// Hot path (AGENTS.md, Performance): the access network samples the walking
// field at every eighth of a cell on three lanes. On a shared-vertex world,
// each sample must stay affine; the full procedural sample (climate, geology)
// is only read once per shared corner.
it('plans an installation reading the procedural terrain once per shared corner, not per walking substep', () => {
  const field = createSpawnTerrainField(landscape);
  let calls = 0;
  const base = {
    ...field,
    sample: (x: number, y: number) => {
      calls++;
      return field.sample(x, y);
    },
  };
  const map = {
    landscape,
    surfaces: [],
    villages: [],
    territories: [],
    terraces: [],
    removedTreeIndices: [],
    vertices: [],
  } as unknown as SpawnMap;
  const plan = planInstallation(
    map,
    {
      commandId: '00000000-0000-4000-8000-000000000000',
      artifactChecksum: '0'.repeat(64),
      kitVersion: STARTER_KIT.version,
      point: { x: 408, y: 232 },
      quarterTurns: 0,
      mode: 'manual',
      playerName: 'P',
      villageName: 'V',
    },
    { protectedSurfaces: [], walkBlockedSurfaces: [] },
    base,
  );
  expect(plan.status).toBe('planned');
  // 144 154 here: elevation and water of the corners visited, for the placed
  // and walking fields. Sampling every substep made 284 416 (1 November 2026).
  expect(calls).toBeLessThan(200_000);
});
