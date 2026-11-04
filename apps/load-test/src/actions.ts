/** Choice of a bot's next gesture (pure). Each action is planned from the
 * village state the bot received, as a player can only use what the HUD
 * offers: an action the village does not allow is not drawn. The server
 * still decides, and its refusals are counted apart (docs/TEST-DE-CHARGE.md §4).
 * No AI: weighted draw among the possible actions. */
import {
  MARKET_QUANTITIES,
  cellVertices,
  constructionCosts,
  extractionPoolSettings,
  type BuildingTypeDefinition,
  type ExpeditionIntent,
  type ExtractionPoolCommand,
  type HarvestIntent,
  type PopulationGesture,
  type TerrainEditsRequest,
  type TradeCommand,
  type VillageState,
} from '@arbestra/contracts';

export const ACTION_KINDS = [
  'reload',
  'harvest',
  'hud-pool',
  'hud-population',
  'build',
  'upgrade',
  'terraform',
  'terrain-restore',
  'market-publish',
  'market-cancel',
  'market-accept',
  'expedition',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export type Mix = Partial<Record<ActionKind, number>>;

/** Default weights: harvesting and the HUD dominate, as in the alpha journeys. */
export const DEFAULT_MIX: Mix = {
  reload: 0.3,
  harvest: 3,
  'hud-pool': 1.5,
  'hud-population': 1.5,
  build: 1,
  upgrade: 1,
  terraform: 1,
  'terrain-restore': 1,
  'market-publish': 1,
  'market-cancel': 0.5,
  'market-accept': 0.5,
  expedition: 0.5,
};

/** "harvest=3,build=1,market-accept=0" over the defaults; `only:` drops the others. */
export function parseMix(text: string | undefined): Mix {
  if (!text) return { ...DEFAULT_MIX };
  const only = text.startsWith('only:');
  const mix: Mix = only ? {} : { ...DEFAULT_MIX };
  for (const part of text
    .replace(/^only:/, '')
    .split(',')
    .filter(Boolean)) {
    const [name, weight] = part.split('=');
    if (!(ACTION_KINDS as readonly string[]).includes(name!) || !Number.isFinite(Number(weight)) || Number(weight) < 0)
      throw new Error(`Mélange invalide : « ${part} » (actions : ${ACTION_KINDS.join(', ')}).`);
    mix[name as ActionKind] = Number(weight);
  }
  return mix;
}

type Cell = { cellX: number; cellY: number };
export interface TerraformRecord {
  cell: Cell;
  /** Corner heights before the stroke (cellVertices order). */
  before: number[];
  /** Height the stroke left at the four corners. */
  height: number;
  at: number;
}
export interface BotMemory {
  terraformed: TerraformRecord[];
}

export type PlannedAction =
  | { kind: 'reload' }
  | { kind: 'harvest'; body: HarvestIntent }
  | { kind: 'hud-pool'; body: ExtractionPoolCommand }
  | { kind: 'hud-population'; body: PopulationGesture }
  | {
      kind: 'build';
      body: {
        commandId: string;
        buildingType: string;
        anchorCellX: number;
        anchorCellY: number;
        cells: Cell[];
        expectedCosts: Array<{ resourceCode: string; amount: number }>;
        quarterTurns: number;
        houseVariant: 'stone' | 'logs' | 'beams';
      };
    }
  | {
      kind: 'upgrade';
      buildingId: string;
      body: {
        commandId: string;
        expectedCosts: Array<{ resourceCode: string; amount: number }>;
        expectedLevel: number;
      };
    }
  | { kind: 'terraform'; body: TerrainEditsRequest; record: TerraformRecord }
  | { kind: 'terrain-restore'; body: TerrainEditsRequest; record: TerraformRecord }
  | { kind: 'market-publish'; body: TradeCommand }
  | { kind: 'market-cancel'; body: TradeCommand }
  | { kind: 'market-accept' }
  | { kind: 'expedition'; body: ExpeditionIntent };

export interface PlanContext {
  state: VillageState;
  memory: BotMemory;
  random: () => number;
  uuid: () => string;
  now: number;
}

const key = (c: Cell) => `${c.cellX}:${c.cellY}`;
const pick = <T>(items: readonly T[], random: () => number): T | undefined =>
  items.length ? items[Math.floor(random() * items.length)] : undefined;
const stock = (state: VillageState, code: string) => state.village.resources.find((r) => r.code === code)?.amount ?? 0;
const affordable = (state: VillageState, costs: ReadonlyArray<{ resourceCode: string; amount: number }>) =>
  costs.every((c) => stock(state, c.resourceCode) >= c.amount);
const wrap = (value: number, size: number) => ((value % size) + size) % size;
function torusGap(a: Cell, b: Cell, state: VillageState) {
  const dx = Math.abs(wrap(a.cellX - b.cellX, state.world.widthCells)),
    dy = Math.abs(wrap(a.cellY - b.cellY, state.world.heightCells));
  return Math.max(Math.min(dx, state.world.widthCells - dx), Math.min(dy, state.world.heightCells - dy));
}

/** Free buildable cells whose eight neighbours are free too: a footprint's
 * leveling rewrites the ring around it, which must stay buildable. */
export function freeCells(state: VillageState): Cell[] {
  const roads = new Set((state.roadCells ?? []).map(key));
  const free = new Set(
    state.cells.filter((c) => c.canBuild && !c.building && !c.footprint && !roads.has(key(c))).map(key),
  );
  const { widthCells, heightCells } = state.world;
  return state.cells
    .filter((c) => free.has(key(c)))
    .filter((c) => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!free.has(`${wrap(c.cellX + dx, widthCells)}:${wrap(c.cellY + dy, heightCells)}`)) return false;
      return true;
    })
    .map((c) => ({ cellX: c.cellX, cellY: c.cellY }));
}

/** Height of a terrain vertex in the presentation's region, null outside it. */
export function regionVertexHeight(state: VillageState, vertexX: number, vertexY: number): number | null {
  const r = state.region,
    heights = r.vertexHeights;
  if (!heights) return null;
  const x = wrap(vertexX - r.originCellX, state.world.widthCells),
    y = wrap(vertexY - r.originCellY, state.world.heightCells);
  if (x > r.width || y > r.height) return null;
  const value = heights[y * (r.width + 1) + x];
  return Number.isFinite(value) ? value! : null;
}

function buildings(state: VillageState) {
  const seen = new Map<string, NonNullable<VillageState['cells'][number]['building']>>();
  for (const c of state.cells) if (c.building && !seen.has(c.building.id)) seen.set(c.building.id, c.building);
  return [...seen.values()];
}
const definition = (state: VillageState, code: string): BuildingTypeDefinition | undefined =>
  state.buildingTypes.find((t) => t.code === code);

function planHarvest({ state, random, uuid }: PlanContext): PlannedAction | null {
  if (state.village.population.available < 1) return null;
  const gardens = buildings(state)
    .flatMap((b) => b.garden?.plots ?? [])
    .filter((p) => p.storedCarrots > 0 && !p.harvest)
    .map((p) => ({ cellX: p.cellX, cellY: p.cellY }));
  const anchor = { cellX: state.village.anchorCellX, cellY: state.village.anchorCellY };
  const deposits = (resource: string) =>
    state.region.features
      .filter((f) => f.deposit?.resourceCode === resource && f.deposit.state === 'available')
      .filter((f) => (f.deposit?.availableAmount ?? 0) > 0)
      .sort((a, b) => torusGap(a, anchor, state) - torusGap(b, anchor, state))
      .slice(0, 6);
  const woods = deposits('wood'),
    stones = deposits('stone');
  const chosenGardens = random() < 0.6 ? gardens.slice(0, 1 + Math.floor(random() * 2)) : [];
  const wood = random() < 0.7 ? pick(woods, random) : undefined;
  const stone = random() < 0.2 ? pick(stones, random) : undefined;
  if (!chosenGardens.length && !wood && !stone) {
    const fallback = gardens[0] ? { gardens: [gardens[0]] } : woods[0] ? { wood: [woods[0].id] } : null;
    if (!fallback) return null;
    return {
      kind: 'harvest',
      body: { commandId: uuid(), gardens: [], wood: [], stone: [], woodMode: 'cut', ...fallback },
    };
  }
  return {
    kind: 'harvest',
    body: {
      commandId: uuid(),
      gardens: chosenGardens,
      wood: wood ? [wood.id] : [],
      woodMode: 'cut',
      stone: stone ? [stone.id] : [],
    },
  };
}

function planPool({ state, random, uuid }: PlanContext): PlannedAction | null {
  const options: ExtractionPoolCommand[] = [];
  for (const pool of state.village.extractionPools ?? [])
    for (const action of ['sites-up', 'sites-down', 'people-up', 'people-down'] as const) {
      try {
        const next = extractionPoolSettings(pool, action);
        if (next.siteCount === pool.siteCount && next.workerCap === pool.workerCap) continue;
        // Bounded like a cautious player: at most three sites, people only while some are free.
        if (action === 'sites-up' && (pool.siteCount >= 3 || state.village.population.available < 3)) continue;
        if (action === 'people-up' && state.village.population.available < 5) continue;
      } catch {
        continue;
      }
      options.push({ commandId: '', resource: pool.resource, action });
    }
  const chosen = pick(options, random);
  return chosen ? { kind: 'hud-pool', body: { ...chosen, commandId: uuid() } } : null;
}

function planPopulation({ state, random, uuid }: PlanContext): PlannedAction | null {
  const p = state.village.population,
    commandId = uuid();
  const options: PopulationGesture[] = [];
  if (p.available > 0) options.push({ commandId, action: 'rest' });
  if (p.working > 0) options.push({ commandId, action: 'release', destination: random() < 0.5 ? 'idle' : 'resting' });
  if (state.village.carrots > 0) {
    if (p.available > 0) options.push({ commandId, action: 'feed', group: 'idle' });
    if (p.working > 0) options.push({ commandId, action: 'feed', group: 'working' });
    if (p.resting > 0) options.push({ commandId, action: 'feed', group: 'resting' });
  }
  const chosen = pick(options, random);
  return chosen ? { kind: 'hud-population', body: chosen } : null;
}

/** Free cells whose four corners are level: the server refuses a footprint on
 * uneven ground (UNEVEN_TERRAIN), the construction palette does not offer it. */
export function flatCells(state: VillageState): Cell[] {
  return freeCells(state).filter((cell) => {
    const heights = cellVertices(cell, state.world).map((v) => regionVertexHeight(state, v.vertexX, v.vertexY));
    return heights.every((h) => h !== null && Math.abs(h - heights[0]!) < 1e-6);
  });
}

function planBuild({ state, random, uuid }: PlanContext): PlannedAction | null {
  const cells = flatCells(state);
  if (cells.length < 3) return null;
  const options: Array<{ type: string; variant: 'stone' | 'logs' | 'beams' }> = [
    { type: 'dwelling', variant: 'logs' },
    { type: 'garden', variant: 'stone' },
    { type: 'sawmill', variant: 'stone' },
  ];
  const counts = new Map<string, number>();
  for (const b of buildings(state)) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  const possible = options.flatMap((o) => {
    const type = definition(state, o.type);
    if (!type?.buildable) return [];
    if (type.instanceLimitPerVillage !== null && (counts.get(o.type) ?? 0) >= type.instanceLimitPerVillage) return [];
    const costs = constructionCosts(type.levels[0], o.variant);
    return affordable(state, costs) ? [{ ...o, costs }] : [];
  });
  const chosen = pick(possible, random),
    cell = pick(cells, random);
  if (!chosen || !cell) return null;
  return {
    kind: 'build',
    body: {
      commandId: uuid(),
      buildingType: chosen.type,
      anchorCellX: cell.cellX,
      anchorCellY: cell.cellY,
      cells: [cell],
      expectedCosts: chosen.costs,
      quarterTurns: 0,
      houseVariant: chosen.variant,
    },
  };
}

function planUpgrade({ state, random, uuid }: PlanContext): PlannedAction | null {
  const options = buildings(state).flatMap((b) => {
    const type = definition(state, b.type);
    const next = type?.levels.find((l) => l.level === b.level + 1);
    if (!type || !next || b.status !== 'completed' || b.targetLevel !== null || type.progressionMode === 'spatial')
      return [];
    // The building's variant is not in the state: expect the dearest one, the server charges its own.
    const variants = (['stone', 'logs', 'beams'] as const).map((v) => constructionCosts(next, v));
    if (!variants.some((costs) => affordable(state, costs))) return [];
    const expected = new Map<string, number>();
    for (const costs of variants)
      for (const c of costs) expected.set(c.resourceCode, Math.max(expected.get(c.resourceCode) ?? 0, c.amount));
    return [
      {
        buildingId: b.id,
        level: next.level,
        expectedCosts: [...expected].map(([resourceCode, amount]) => ({ resourceCode, amount })),
      },
    ];
  });
  const chosen = pick(options, random);
  return chosen
    ? {
        kind: 'upgrade',
        buildingId: chosen.buildingId,
        body: { commandId: uuid(), expectedCosts: chosen.expectedCosts, expectedLevel: chosen.level },
      }
    : null;
}

function planTerraform({ state, memory, random, uuid, now }: PlanContext): PlannedAction | null {
  if (memory.terraformed.length >= 5) return null;
  const touched = new Set(memory.terraformed.map((r) => key(r.cell)));
  const cell = pick(
    freeCells(state).filter((c) => !touched.has(key(c))),
    random,
  );
  if (!cell) return null;
  const before = cellVertices(cell, state.world).map((v) => regionVertexHeight(state, v.vertexX, v.vertexY));
  if (before.some((h) => h === null)) return null;
  // One quarter above the highest corner, on the quarter grid of the brush.
  const height = Math.ceil((Math.max(...(before as number[])) + 0.25) / 0.25 - 1e-9) * 0.25;
  const record: TerraformRecord = { cell, before: before as number[], height, at: now };
  return {
    kind: 'terraform',
    record,
    body: { commandId: uuid(), gestures: [{ buildingType: 'terrain', anchor: cell, cells: [cell], height }] },
  };
}

function planRestore({ memory, uuid, now }: PlanContext): PlannedAction | null {
  const record = memory.terraformed.at(-1);
  if (!record || now - record.at < 3000) return null;
  return {
    kind: 'terrain-restore',
    record,
    body: {
      commandId: uuid(),
      gestures: [
        {
          buildingType: 'terrain-restore',
          cells: [
            {
              ...record.cell,
              corners: record.before,
              expected: [record.height, record.height, record.height, record.height],
            },
          ],
        },
      ],
    },
  };
}

const myOpenOffers = (state: VillageState) =>
  (state.village.market?.offers ?? []).filter((o) => o.status === 'open' && o.villageId === state.village.id);

function planPublish({ state, random, uuid }: PlanContext): PlannedAction | null {
  if (!state.village.market?.unlocked || myOpenOffers(state).length >= 3) return null;
  const pairs = [
    ['wood', 'carrot'],
    ['carrot', 'wood'],
    ['wood', 'stone'],
  ] as const;
  const amount = MARKET_QUANTITIES[0];
  const possible = pairs.filter(([offered]) => stock(state, offered) >= amount * 2);
  const pair = pick(possible, random);
  if (!pair) return null;
  return {
    kind: 'market-publish',
    body: {
      action: 'publish',
      commandId: uuid(),
      offeredResource: pair[0],
      offeredAmount: amount,
      requestedResource: pair[1],
      requestedAmount: amount,
      maxTravelSeconds: 600,
    },
  };
}

function planCancel({ state, random, uuid }: PlanContext): PlannedAction | null {
  const offer = pick(myOpenOffers(state), random);
  return offer ? { kind: 'market-cancel', body: { action: 'cancel', commandId: uuid(), offerId: offer.id } } : null;
}

function planExpedition({ state, random, uuid }: PlanContext): PlannedAction | null {
  if (!state.science || state.science.cartographers < 1) return null;
  const { widthCells, heightCells } = state.world;
  return {
    kind: 'expedition',
    body: {
      commandId: uuid(),
      action: 'survey',
      target: {
        cellX: wrap(state.village.anchorCellX + Math.round((random() - 0.5) * 40), widthCells),
        cellY: wrap(state.village.anchorCellY + Math.round((random() - 0.5) * 40), heightCells),
      },
      budgetSeconds: 600,
    },
  };
}

const planners: Record<ActionKind, (context: PlanContext) => PlannedAction | null> = {
  reload: () => ({ kind: 'reload' }),
  harvest: planHarvest,
  'hud-pool': planPool,
  'hud-population': planPopulation,
  build: planBuild,
  upgrade: planUpgrade,
  terraform: planTerraform,
  'terrain-restore': planRestore,
  'market-publish': planPublish,
  'market-cancel': planCancel,
  'market-accept': ({ state }) => (state.village.market?.unlocked ? { kind: 'market-accept' } : null),
  expedition: planExpedition,
};

export const planAction = (kind: ActionKind, context: PlanContext) => planners[kind](context);

/** Weighted draw among the actions the village allows; null when none is. */
export function chooseAction(mix: Mix, context: PlanContext): PlannedAction | null {
  const pool = ACTION_KINDS.filter((k) => (mix[k] ?? 0) > 0).map((k) => ({ kind: k, weight: mix[k]! }));
  while (pool.length) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let draw = context.random() * total,
      index = 0;
    while (index < pool.length - 1 && draw >= pool[index]!.weight) draw -= pool[index++]!.weight;
    const planned = planAction(pool[index]!.kind, context);
    if (planned) return planned;
    pool.splice(index, 1);
  }
  return null;
}

/** Offers a bot may accept: open, of another bot only (never a real player's). */
export const BOT_VILLAGE_NAME = /^Bot \d{3,5}$/;
export function acceptableOffers(
  offers: ReadonlyArray<{
    id: string;
    villageId: string;
    villageName: string;
    status: string;
    requestedResource: string;
    requestedAmount: number;
  }>,
  state: VillageState,
) {
  return offers.filter(
    (o) =>
      o.status === 'open' &&
      o.villageId !== state.village.id &&
      BOT_VILLAGE_NAME.test(o.villageName) &&
      stock(state, o.requestedResource) >= o.requestedAmount,
  );
}
