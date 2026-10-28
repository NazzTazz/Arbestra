import { travelDuration } from '@arbestra/contracts';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh as BabylonMesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { TravelCell, VillageState, GardenHarvestStop } from '@arbestra/contracts';
import {
  WorkerTraffic,
  WORKER_STEP,
  WORKER_REBUILD_MS,
  WORKER_CLEARANCE,
  pathLength,
  sampleWorkerPath,
  workerAppearance,
  gardenHarvestPoint,
  workerPassagePath,
  type DoorLane,
  type TrafficActor,
  type WorkerPoint,
  type WorkerRole,
} from './worker-motion';
import { worksiteLayout, worksiteConnector, type WorksiteLayout, type WorkStation } from './worksite-layout';
import { PILE_LOGS, WOOD_SECTIONS, pileSlot, woodFallAt, woodPlannedFall, woodSite } from './worksite-site';
import { treePieceData, trunkTop, type TreeVariant } from './grove-trees';
import { idleTour, idleTourPhase, type IdleLeg, type IdleVisit } from './idle-tour';
import {
  buildWorkerFigure,
  HAIR_STYLES,
  villagerPieceData,
  type PieceTint,
  type VillagerHat,
  type VillagerPiece,
  type VillagerTool,
} from './worker-figure';
import {
  ROLE_TOOL,
  StrikePlan,
  ROLE_GESTURE,
  carryPose,
  copyPose,
  ease,
  GESTURE_BLEND_S,
  gardenPose,
  gardenStride,
  gestureSeed,
  isGestureRole,
  mixPose,
  newPose,
  sawPose,
  sawStroke,
  SAW_GRIP,
  teamActivity,
  walkPose,
  type GestureName,
  type Pose,
} from './worker-gestures';

interface Materials {
  skin: StandardMaterial[];
  clothes: StandardMaterial[];
  hair: StandardMaterial[];
  pants: StandardMaterial;
  /** For pieces with absolute vertex colours: hats, tools, carried loads. */
  white: StandardMaterial;
  timber: StandardMaterial;
  stone: StandardMaterial;
}
/** A presentation path point; door lanes carry their tag and file width. */
export type PathPoint = Vector3 & { lane?: DoorLane; width?: number };
export interface WorkerHooks {
  /** Hall journey outward; `lane` picks the door lane walked in that direction ('out' by default). */
  path: (path: TravelCell[], lane?: DoorLane) => PathPoint[];
  project: (point: TravelCell) => WorkerPoint;
  ground: (point: WorkerPoint) => number | null;
  free: (point: WorkerPoint, radius: number, featureId: string | null, allowRoads?: boolean) => boolean;
  key: (point: WorkerPoint) => string;
  detailed: (point: WorkerPoint) => boolean;
  width?: (point: WorkerPoint) => number;
  localPath?: (path: TravelCell[]) => Vector3[];
  leisurePath?: (buildingId: string, path: TravelCell[], lane?: DoorLane) => PathPoint[];
  /** Changes when projected positions or ground heights used by leisurePath change. */
  leisureVersion?: () => string;
  /**
   * The grove tree a wood lot fells, from the scene's grove (grove-trees.ts);
   * the scene hides it in the grove until `releaseTree` and the server's cut.
   */
  fellTree?: (featureId: string, near: WorkerPoint, lotId: string) => FelledTree | null;
  releaseTree?: (lotId: string) => void;
  /**
   * Room for the felling layout: real trunks (the felled tree excepted),
   * buildings, water and equipment; paths allowed, no exclusion around the
   * grove. Falls back to `free` when absent.
   */
  stageFree?: (point: WorkerPoint, radius: number) => boolean;
}
/** A real grove tree, in scene units: kit variant, scales and its own turn. */
export interface FelledTree extends WorkerPoint {
  variant: TreeVariant;
  scale: number;
  heightScale: number;
  yaw: number;
  /** Share of a trunk already lying when the lot starts; 0 for a standing tree. */
  lying: number;
  /** Wood of one tree slot: a lot consumes `reserved / share` of a trunk. */
  share: number;
}
interface Mission {
  id: string;
  key: string;
  resource: 'wood' | 'stone' | 'garden' | 'idle' | 'survey' | 'trade' | 'leveling';
  count: number;
  /** Wood reserved by an extraction lot; absent for other missions. */
  reserved?: number;
  featureId: string | null;
  path: TravelCell[];
  target: TravelCell;
  startedAt: number;
  completesAt: number;
  transportMs: number;
  stops?: GardenHarvestStop[];
  returnPath?: TravelCell[];
  leisure?: IdleLeg[];
}
type Phase = 'outbound' | 'install' | 'rotate' | 'work' | 'load' | 'inbound' | 'inside' | 'done';
export interface VillageWorkerFigure {
  root: TransformNode;
  dispose: () => void;
}
export interface RepresentativeInfo {
  id: string;
  name: string;
  cohortSize: number | null;
  energy: number | null;
  qualifications: string[];
  destination: string;
  mode: string;
  cohortId: string | null;
  presence: 'visible' | 'inside' | 'ground-unavailable' | 'offscreen';
  waiting: boolean;
}
interface Person extends VillageWorkerFigure {
  actor: TrafficActor;
  index: number;
  role: WorkerRole;
  phase: Phase;
  phaseAt: number;
  arrivedAt: number;
  limbs: TransformNode[];
  waist: TransformNode;
  tools: Map<VillagerTool, TransformNode>;
  cargo: TransformNode;
  carrot: TransformNode | null;
  basket: TransformNode | null;
  meshes: Mesh[];
  /** Gesture seed and plans by gesture, the pose shown and the pose a transition blends from. */
  seed: number;
  plans: Map<GestureName, StrikePlan>;
  pose: Pose;
  blendFrom: Pose;
  blendAt: number;
  motion: string;
  angle: number;
  fade: number;
  visible: boolean;
  walk: number;
  last: WorkerPoint;
  previous: WorkerPoint;
  working: boolean;
  /** Reached a post: a latecomer joining the return never carries a load. */
  worked: boolean;
  /** Points of the exit connector at the head of an inbound path; 0 when none. */
  exit: number;
  connectorRetry: number;
  retireAt: number | null;
  harvestProgress: number | null;
  cohortId: string | null;
  valid: boolean;
}
interface Group {
  mission: Mission;
  people: Person[];
  route: WorkerPoint[];
  layout: WorksiteLayout;
  root: TransformNode;
  /** Gesture seeds, from the mission key: the team's task sharing and each saw pair. */
  seed: number;
  sawSeeds: Map<number, number>;
  saws: Mesh[];
  blocks: Mesh[];
  /** Felled tree, trunk sections and log pile of a wood site (presentation only). */
  wood: WoodProps | null;
  retired: boolean;
  createdAt: number;
  stop: number;
}

interface WoodProps {
  /** At the tree's foot, turned towards its fall; `tilt` lays it down. Null without a grove tree. */
  heading: TransformNode | null;
  tilt: TransformNode | null;
  trunk: Mesh | null;
  crown: Mesh | null;
  /** The grove tree felled by this lot, hidden in the grove meanwhile. */
  tree: FelledTree | null;
  logs: Mesh[];
  base: WorkerPoint;
  pile: WorkerPoint;
  /** Index of the person whose arrival lets the tree fall, and when it got there (s from W0). */
  feller: number;
  fellerAt: number | null;
  plan: WoodPlan | null;
}
/** What a wood site's layout found, for the debug overlay. */
interface WoodPlanState {
  kind: 'nul' | 'arbre-seul' | 'binome' | 'binome-sans-place';
  /** Fall heading in degrees, null without a tree. */
  fall: number | null;
}
/** Where the wood site works around the felled grove tree, in group-local units. */
interface WoodPlan {
  tree: FelledTree;
  base: WorkerPoint;
  /** Unit direction of the fall, and of saw pair 0's line across it. */
  fall: WorkerPoint;
  across: WorkerPoint;
  /** Length of the trunk under its foliage. */
  length: number;
  /** Saw pair 0, when it fells and cuts up the tree itself. */
  pair0: number[];
}
/** Trunk radius of a kit tree at scale 1: a tree lying without its foliage rests on it. */
const KIT_TRUNK_RADIUS = 0.19;
/** A strike visibly shakes the standing tree, damped in 0.4 s (Tristan: the shake must show). */
const TREE_SHAKE = 0.05;
const PILE_LOG = { length: 0.32, diameter: 0.075 };

/** The hat tells the trade at a glance, at medium zoom (blender-elements/villageois). */
const WORKER_HATS: Record<Mission['resource'], VillagerHat | null> = {
  wood: 'bonnet',
  stone: 'casque',
  leveling: 'casque',
  garden: 'paille',
  survey: 'beret',
  idle: null,
  trade: null,
};
const scratchPose = newPose();
/** Body margin of exit connectors over the traffic's swept clearance. */
const EXIT_MARGIN = 0.03;
/** Two-man saw blade: centre height above the ground, its lower edge on the trunk's top (0.375 m). */
const SAW_BLADE = { y: 0.4, height: 0.055 };

/** All positions and short visual tails live here; no economic writes or timers. */
export class VillageWorkers {
  readonly #groups = new Map<string, Group>();
  readonly #latest = new Map<string, Mission>();
  readonly #woodPlans = new Map<string, WoodPlanState>();
  readonly #traffic = new WorkerTraffic();
  #lastNow: number | null = null;
  #accumulator = 0;
  #graphDirty = true;
  #lastAnimation = 0;
  #boxSource: Mesh | null = null;
  readonly #pieceSources = new Map<VillagerPiece, Mesh>();
  readonly #costs: number[] = [];
  readonly #finished = new Set<string>();
  readonly #pending = new Set<string>();
  #identity: string | null = null;
  #populationMode = false;
  #populationFocus: string | null = null;
  #populationFilter = 'all';
  #snapshot: VillageState | null = null;
  // Home itineraries, recomputed per home only when its cell, the routes or the
  // scene geometry change: state updates are mostly harvests, not new homes.
  #leisure: {
    routes: VillageState['travelRoutes'] | null;
    geometry: string;
    byDestination: Map<string, VillageState['travelRoutes'][number]>;
    visits: Map<string, { cell: VillageState['cells'][number]; visit: IdleVisit | null }>;
  } = { routes: null, geometry: '', byDestination: new Map(), visits: new Map() };
  #selectedRepresentative: string | null = null;
  #hiddenRepresentative: string | null = null;
  readonly #installationDistances = new WeakMap<WorksiteLayout, number>();
  readonly #reservedLayouts = new WeakMap<WorksiteLayout, Map<number, WorkerPoint[]>>();
  constructor(
    readonly scene: Scene,
    readonly materials: Materials,
    readonly hooks: WorkerHooks,
  ) {}
  get figures(): VillageWorkerFigure[] {
    return [...this.#groups.values()].flatMap((g) => g.people);
  }
  /** What each wood site's felling layout found, for the debug overlay. */
  get woodPlans() {
    return [...this.#groups.values()].flatMap((g) => {
      const plan = this.#woodPlans.get(g.mission.id);
      return plan ? [{ id: g.mission.id, ...plan }] : [];
    });
  }
  get metrics() {
    return {
      figures: this.figures.length,
      idleRepresentatives: [...this.#groups.values()].filter((g) => g.mission.resource === 'idle').length,
      blocked: this.#traffic.blocked,
      pending: this.#pending.size,
      updateMs: this.#costs.length ? this.#costs.reduce((a, b) => a + b, 0) / this.#costs.length : 0,
      maxUpdateMs: Math.max(0, ...this.#costs),
      woodPlans: this.woodPlans,
      layouts: [...this.#groups.values()].map((g) => ({
        id: g.mission.id,
        resource: g.mission.resource,
        variant: g.layout.variant,
        roles: g.people.map((p) => p.role),
        phases: g.people.map((p) => p.phase),
      })),
    };
  }

  sync(state: VillageState, now: number) {
    this.#snapshot = state;
    const identity = `${state.world.id}:${state.village.id}`;
    if (this.#identity !== null && this.#identity !== identity) {
      for (const g of this.#groups.values()) this.#disposeGroup(g);
      this.#groups.clear();
      this.#latest.clear();
      this.#finished.clear();
      this.#pending.clear();
      this.#traffic.reset();
      this.#lastNow = null;
      this.#accumulator = 0;
      this.#graphDirty = true;
      this.#selectedRepresentative = null;
      this.#hiddenRepresentative = null;
    }
    this.#identity = identity;
    const sites = new Map(
      state.village.worksites.flatMap((s) => (s.activeExtraction ? [[s.activeExtraction.id, s.id] as const] : [])),
    );
    const missions: Mission[] = state.village.extractions.map((e) => ({
      id: e.id,
      key: `${state.world.id}:${state.village.id}:${sites.get(e.id) ?? e.id}`,
      resource: e.resourceCode === 'wood' ? 'wood' : 'stone',
      count: e.workerCount,
      reserved: e.reservedAmount,
      featureId: e.featureId,
      path: e.path,
      target: e,
      startedAt: Date.parse(e.startedAt),
      completesAt: Date.parse(e.completesAt),
      transportMs: e.transportMs,
    }));
    for (const cell of state.cells)
      for (const plot of cell.building?.garden?.plots ?? [])
        if (plot.harvest) {
          const h = plot.harvest;
          missions.push({
            id: h.id,
            key: `${state.world.id}:${state.village.id}:${h.id}`,
            resource: 'garden',
            count: 1,
            featureId: null,
            path: h.path,
            target: h.stops?.[0] ?? plot,
            startedAt: Date.parse(h.startedAt),
            completesAt: Date.parse(h.completesAt),
            transportMs: h.transportMs,
            ...(h.stops?.length ? { stops: h.stops, returnPath: h.returnPath ?? [] } : {}),
          });
        }
    for (const activity of state.science?.activities ?? []) {
      if (
        activity.villageId !== state.village.id ||
        !['survey', 'exploration'].includes(activity.kind) ||
        !activity.path.length
      )
        continue;
      const path = activity.path.slice(0, Math.ceil(activity.path.length / 2));
      missions.push({
        id: activity.id,
        key: `${identity}:${activity.id}`,
        resource: 'survey',
        count: 1,
        featureId: null,
        path,
        target: path[path.length - 1]!,
        startedAt: Date.parse(activity.startedAt),
        completesAt: Date.parse(activity.completesAt),
        transportMs: travelDuration(path, state.world),
      });
    }
    for (const journey of state.village.market?.journeys ?? []) {
      missions.push({
        id: journey.id,
        key: `${state.world.id}:trade:${journey.id}`,
        resource: 'trade',
        count: journey.workerCount,
        featureId: null,
        path: journey.path,
        target: journey.path.at(-1)!,
        startedAt: Date.parse(journey.startedAt),
        completesAt: Date.parse(journey.returnsAt),
        transportMs: Date.parse(journey.arrivesAt) - Date.parse(journey.startedAt),
      });
    }
    for (const job of state.village.levelingJobs ?? []) {
      missions.push({
        id: job.id,
        key: `${identity}:leveling:${job.id}`,
        resource: 'leveling',
        count: job.workerCount,
        featureId: job.featureId,
        path: job.path,
        target: job.path.at(-1)!,
        startedAt: Date.parse(job.startedAt),
        completesAt: Date.parse(job.completesAt),
        transportMs: job.transportMs,
      });
    }
    missions.push(...this.#idleMissions(state));
    this.#latest.clear();
    for (const m of missions) this.#latest.set(m.key, m);
    for (const key of this.#pending) if (!this.#latest.has(key)) this.#pending.delete(key);
    for (const id of this.#finished) if (!missions.some((m) => m.id === id)) this.#finished.delete(id);
    for (const [key, g] of this.#groups) {
      g.retired = this.#latest.get(key)?.id !== g.mission.id;
      for (const p of g.people)
        p.valid &&=
          !g.retired &&
          p.index < (this.#latest.get(key)?.count ?? 0) &&
          p.cohortId === (this.#cohort(g.mission, p.index)?.id ?? null);
      if (g.mission.resource === 'survey') {
        const next = this.#latest.get(key);
        if (next) {
          const changed = JSON.stringify(next.path) !== JSON.stringify(g.mission.path);
          g.mission = next;
          if (changed) {
            g.route = this.#route(next);
            g.layout = this.#layout(next, g.route);
            for (const person of g.people) if (person.phase === 'outbound') this.#reroute(person, g.route);
            this.#graphDirty = true;
          }
        }
      }
      if (g.mission.resource === 'idle') {
        const next = this.#latest.get(key);
        if (!next) {
          this.#disposeGroup(g);
          this.#groups.delete(key);
          this.#graphDirty = true;
          continue;
        }
        // Adopt changed itineraries at the reached door, never mid-walk.
      }
    }
    this.#admit(now);
  }
  #cohort(m: Mission, index: number) {
    const cohorts = this.#snapshot?.village.population?.cohorts ?? [];
    if (m.resource === 'idle') return cohorts.find((c) => c.id === m.id.split(':')[3]);
    return cohorts
      .filter((c) => c.assignmentId === m.id)
      .sort((a, b) => a.id.localeCompare(b.id))
      .find((c) => {
        index -= c.memberCount;
        return index < 0;
      });
  }
  #presence(p: Person): RepresentativeInfo['presence'] {
    return p.phase === 'inside'
      ? 'inside'
      : this.hooks.ground(p.actor.position) === null
        ? 'ground-unavailable'
        : p.root.isEnabled()
          ? 'visible'
          : 'offscreen';
  }
  #reroute(p: Person, route: WorkerPoint[]) {
    // Follow the remaining committed passage to a shared waypoint. No shortcut
    // cuts across the corner or moves the figure to an absolute mission phase.
    const a = p.actor,
      offset = (a.member ?? 0) * 0.5 * Math.cos(((a.formation ?? 0) * Math.PI) / 2),
      distance = Math.max(0, a.distance - offset);
    let length = 0,
      segment = 1;
    for (; segment < a.path.length; segment++) {
      length += pathLength(a.path.slice(segment - 1, segment + 1));
      if (length >= distance) break;
    }
    const centre = sampleWorkerPath(a.path, distance),
      tail = a.path.slice(segment);
    const shared = tail.findIndex((q) => route.some((r) => Math.hypot(q.x - r.x, q.z - r.z) < 0.01));
    if (shared < 0) return; // Keep the committed leg if no safe road junction is shared.
    const junction = tail[shared]!,
      join = route.findIndex((r) => Math.hypot(junction.x - r.x, junction.z - r.z) < 0.01);
    a.path = [{ ...a.position }, { ...centre }, ...tail.slice(0, shared + 1), ...route.slice(join + 1)];
    a.distance = 0;
    a.member = 0;
    a.formation = 0;
    a.lateral = 0;
    a.done = false;
    a.waitingSince = null;
  }
  #idleMissions(state: VillageState): Mission[] {
    if (!this.hooks.leisurePath) return [];
    const homes = state.cells.filter(
      (c) => c.building?.status === 'completed' && ['dwelling', 'town-hall'].includes(c.building.type),
    );
    const geometry = this.hooks.leisureVersion?.() ?? '';
    if (homes.length && (this.#leisure.routes !== state.travelRoutes || this.#leisure.geometry !== geometry)) {
      const byDestination = new Map<string, VillageState['travelRoutes'][number]>();
      for (const r of state.travelRoutes) {
        const key = `${r.destination.cellX}:${r.destination.cellY}`;
        if (r.kind === 'building' && !byDestination.has(key)) byDestination.set(key, r);
      }
      this.#leisure = { routes: state.travelRoutes, geometry, byDestination, visits: new Map() };
    }
    const previous = this.#leisure.visits,
      cached = new Map<string, { cell: VillageState['cells'][number]; visit: IdleVisit | null }>();
    const visits: IdleVisit[] = homes
      .flatMap((c) => {
        const known = previous.get(c.building!.id);
        if (known?.cell === c) {
          cached.set(c.building!.id, known);
          return known.visit ? [known.visit] : [];
        }
        const route = this.#leisure.byDestination.get(`${c.cellX}:${c.cellY}`);
        const path = c.building!.type === 'town-hall' ? [c] : route?.cells;
        const spoke = (lane: DoorLane) => {
          const points = path ? this.hooks.leisurePath!(c.building!.id, path, lane) : [];
          return points.map((v, i) =>
            this.#point(v, v.width ?? (i === 0 || i === points.length - 1 ? 0.5 : (this.hooks.width?.(v) ?? 0.8))),
          );
        };
        const points = spoke('out');
        // Walked back towards the hall, a spoke ends on the door's entry lane.
        const visit = points.length ? { buildingId: c.building!.id, path: points, back: spoke('in') } : null;
        cached.set(c.building!.id, { cell: c, visit });
        return visit ? [visit] : [];
      })
      .sort((a, b) => a.buildingId.localeCompare(b.buildingId));
    this.#leisure.visits = cached;
    const result: Mission[] = [];
    let left = Math.min(8, Math.ceil((state.village.population?.available ?? 0) / 15));
    const cohorts = (state.village.population?.cohorts ?? [])
      .filter((c) => c.activity === 'idle')
      .sort((a, b) => b.memberCount - a.memberCount || a.id.localeCompare(b.id));
    for (const cohort of cohorts) {
      const count = Math.min(left, Math.ceil(cohort.memberCount / 15));
      for (let i = 0; i < count; i++) {
        const key = `${state.world.id}:${state.village.id}:idle:${cohort.id}:${i}`,
          leisure = idleTour(visits, key);
        if (!leisure.length) continue;
        result.push({
          id: key,
          key,
          resource: 'idle',
          count: 1,
          featureId: null,
          path: [],
          target: { cellX: 0, cellY: 0 },
          startedAt: 0,
          completesAt: Infinity,
          transportMs: 0,
          leisure,
        });
      }
      left -= count;
      if (left <= 0) break;
    }
    return result;
  }
  #admit(now: number) {
    for (const [key, mission] of this.#latest) {
      if (this.#finished.has(mission.id)) continue;
      const old = this.#groups.get(key);
      if (old) {
        if (old.mission.id !== mission.id) this.#pending.add(key);
        continue;
      }
      this.#pending.delete(key);
      this.#groups.set(key, this.#create(mission, now));
      this.#graphDirty = true;
    }
  }
  #point(p: WorkerPoint, width = 0.8): WorkerPoint {
    const point: WorkerPoint = { x: p.x, z: p.z, width, key: this.hooks.key(p) };
    if (p.lane) point.lane = p.lane;
    return point;
  }
  /** Outward route of a stop; `lane` is the hall door lane it carries (the entry lane for a return). */
  #route(m: Mission, stop = 0, lane: DoorLane = 'out') {
    if (m.leisure) return m.leisure[stop]!.path.map((p) => this.#point(p, p.width));
    const path = m.stops?.[stop]?.path ?? m.path;
    const vectors: PathPoint[] =
      stop > 0 || m.resource === 'trade'
        ? (this.hooks.localPath ?? this.hooks.path)(path)
        : this.hooks.path(path, lane);
    const passage =
      m.resource === 'wood' || m.resource === 'stone' || m.resource === 'leveling'
        ? workerPassagePath(vectors)
        : vectors;
    const p = passage.map((v, i) =>
      this.#point(v, v.width ?? (stop === 0 && i < 2 ? 0.5 : (this.hooks.width?.(v) ?? 0.8))),
    );
    if (!p.length) p.push(this.#point(this.hooks.project(m.target)));
    if (
      m.resource !== 'garden' &&
      m.resource !== 'survey' &&
      m.resource !== 'trade' &&
      m.resource !== 'leveling' &&
      p.length > 1
    ) {
      const a = p[p.length - 2]!,
        b = p[p.length - 1]!,
        length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length > 0.95) {
        b.x -= ((b.x - a.x) / length) * 0.95;
        b.z -= ((b.z - a.z) / length) * 0.95;
        b.key = this.hooks.key(b);
      }
    }
    return p;
  }
  #layout(m: Mission, route: WorkerPoint[], stop = 0) {
    if (m.resource === 'idle' || m.resource === 'survey' || m.resource === 'trade') {
      const end = route[route.length - 1]!;
      return {
        stations: Array.from({ length: m.count }, () => ({ ...end, role: 'walk' as const, facing: 0, pair: -1 })),
        approach: end,
        variant: 'front' as const,
      };
    }
    const target = this.hooks.project(m.stops?.[stop] ?? m.target),
      last = route[Math.max(0, route.length - 2)] ?? target;
    const available = (p: WorkerPoint, r: number, allowRoads = false) =>
      this.hooks.free(p, r, m.featureId, allowRoads) &&
      ![...this.#groups.values()].some(
        (g) => g.mission.id !== m.id && g.layout.stations.some((s) => Math.hypot(p.x - s.x, p.z - s.z) < r + 0.27),
      );
    const layout = worksiteLayout(m.resource === 'leveling' ? 'stone' : m.resource, m.count, target, last, available);
    // Prefer posts outside traffic. A road crossing a nearly cleared woodland
    // remains walkable; it must not make every valid physical post impossible.
    return layout.variant === 'blocked' && m.resource !== 'garden'
      ? worksiteLayout(m.resource === 'leveling' ? 'stone' : m.resource, m.count, target, last, (p, r) =>
          available(p, r, true),
        )
      : layout;
  }
  #create(mission: Mission, now: number): Group {
    const stop = mission.stops
      ? Math.max(
          0,
          mission.stops.findIndex((s) => now < mission.startedAt + s.workEndsAfterMs),
        )
      : 0;
    const route = this.#route(mission, stop),
      layout = this.#layout(mission, route, stop),
      root = new TransformNode(`worksite-${mission.id}`, this.scene);
    const group: Group = {
      mission,
      route,
      layout,
      root,
      seed: gestureSeed(mission.key, -1),
      sawSeeds: new Map(),
      people: [],
      saws: [],
      blocks: [],
      wood: null,
      retired: false,
      createdAt: now,
      stop,
    };
    for (let i = 0; i < mission.count; i++) group.people.push(this.#person(group, i, now));
    this.#props(group);
    return group;
  }
  #box(
    name: string,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    material: StandardMaterial,
    parent: TransformNode,
  ) {
    this.#boxSource ??= MeshBuilder.CreateBox('worker-box-geometry', { size: 1 }, this.scene);
    this.#boxSource.setEnabled(false);
    const mesh = this.#boxSource.clone(name, parent)!;
    mesh.setEnabled(true);
    mesh.scaling.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }
  /** A clone of the shared figurine piece: geometry is shared, tint comes from the material. */
  #piece(name: string, piece: VillagerPiece, material: StandardMaterial, parent: TransformNode) {
    let source = this.#pieceSources.get(piece);
    if (!source) {
      source = new BabylonMesh(`worker-piece-${piece}`, this.scene);
      villagerPieceData(piece).applyToMesh(source);
      source.setEnabled(false);
      source.isPickable = false;
      this.#pieceSources.set(piece, source);
    }
    const mesh = source.clone(name, parent)!;
    mesh.setEnabled(true);
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }
  #person(group: Group, index: number, now: number): Person {
    const m = group.mission,
      appearance = workerAppearance(m.key, index),
      root = new TransformNode(`worker-${m.id}-${index}`, this.scene);
    const meshes: Mesh[] = [],
      skin = this.materials.skin[appearance.skin]!,
      clothes = this.materials.clothes[appearance.clothes]!,
      hair = this.materials.hair[appearance.hair]!;
    const tints: Record<PieceTint, StandardMaterial> = {
      skin,
      clothes,
      hair,
      pants: this.materials.pants,
      white: this.materials.white,
    };
    const piece = (name: VillagerPiece, tint: PieceTint, parent: TransformNode) => {
      const mesh = this.#piece(`${root.name}-${name}`, name, tints[tint], parent);
      meshes.push(mesh);
      return mesh;
    };
    const style = HAIR_STYLES[(appearance.skin + appearance.hair + index) % HAIR_STYLES.length]!;
    const { limbs, waist } = buildWorkerFigure(root, piece, style, WORKER_HATS[m.resource]);
    const populationId = m.resource === 'idle' ? m.id.split(':')[3]! : m.id;
    for (const mesh of meshes.slice(0, 2))
      mesh.metadata = {
        populationId,
        representativeId: `${m.id}:${index}`,
        populationActivity: m.resource === 'idle' ? 'idle' : 'working',
        populationKind: m.resource === 'survey' ? 'science' : m.resource,
      };
    const role = group.layout.stations[index]!.role;
    const attach = (name: string, pieceName: VillagerPiece, parent: TransformNode) => {
      const node = new TransformNode(`${root.name}-${name}`, this.scene);
      node.parent = parent;
      piece(pieceName, 'white', node);
      node.setEnabled(false);
      return node;
    };
    const cargo = attach('cargo', m.resource === 'wood' ? 'charge-buches' : 'charge-panier', root);
    const garden = m.resource === 'garden';
    const carrot = garden ? attach('carrot', 'carotte', limbs[1]!) : null,
      basket = garden ? attach('basket', 'panier-main', limbs[0]!) : null;
    root.setEnabled(false);
    const startAt = m.startedAt + Math.floor(index / 2) * 0.23 * 1000,
      actor: TrafficActor = {
        id: root.name,
        mission: m.id,
        rank: Math.floor(index / 2),
        member: index % 2,
        formation: 0,
        direction: 1,
        path: group.route,
        distance: 0,
        speed: Math.max(0.8, pathLength(group.route) / Math.max(0.5, m.transportMs / 1000)),
        position: { ...group.route[0]! },
        visible: false,
        waitingSince: null,
        startAt,
        done: false,
      };
    const person: Person = {
      root,
      dispose: () => root.dispose(false, false),
      actor,
      index,
      role,
      phase: 'outbound',
      phaseAt: startAt,
      arrivedAt: 0,
      limbs,
      waist,
      tools: new Map(),
      cargo,
      carrot,
      basket,
      meshes,
      seed: gestureSeed(m.key, index),
      plans: new Map(),
      pose: newPose(),
      blendFrom: newPose(),
      blendAt: -Infinity,
      motion: '',
      angle: 0,
      fade: 0,
      visible: false,
      walk: index * 0.9,
      last: { ...actor.position },
      previous: { ...actor.position },
      working: false,
      worked: false,
      exit: 0,
      connectorRetry: 0,
      retireAt: null,
      harvestProgress: null,
      cohortId: this.#cohort(m, index)?.id ?? null,
      valid: true,
    };
    this.#reconstructPerson(person, group, now);
    if (m.resource === 'trade') {
      person.previous = { ...person.actor.position };
      person.last = { ...person.actor.position };
    }
    return person;
  }
  #reconstructPerson(p: Person, g: Group, now: number) {
    const m = g.mission,
      outEnd = m.startedAt + m.transportMs,
      backStart = m.completesAt - m.transportMs;
    if (m.resource === 'trade') {
      const returning = now >= outEnd,
        path = returning ? [...g.route].reverse() : g.route;
      const progress = Math.max(0, Math.min(1, (now - (returning ? outEnd : m.startedAt)) / m.transportMs));
      p.phase = now >= m.completesAt ? 'done' : returning ? 'inbound' : 'outbound';
      p.actor.path = path;
      p.actor.direction = returning ? -1 : 1;
      p.actor.visible = now >= m.startedAt && now < m.completesAt;
      p.actor.distance = Math.max(0, pathLength(path) * progress - p.index * 0.35);
      p.actor.position = sampleWorkerPath(path, p.actor.distance);
      p.actor.speed = pathLength(path) / (m.transportMs / 1000);
      p.actor.startAt = now;
      p.actor.done = p.phase === 'done';
      p.working = false;
      return;
    }
    p.harvestProgress = null;
    p.actor.waitingSince = null;
    p.actor.done = false;
    p.actor.visible = false;
    p.actor.local = false;
    p.exit = 0;
    p.actor.member = p.index % 2;
    p.actor.formation = 0;
    p.actor.lateral = 0;
    p.visible = false;
    p.fade = 0;
    p.worked = now >= (m.stops?.length ? m.startedAt + m.stops[0]!.arrivesAfterMs : outEnd);
    if (m.leisure) {
      const current = idleTourPhase(m.leisure, now, m.key);
      g.stop = current.leg;
      g.route = this.#route(m, g.stop);
      g.layout = this.#layout(m, g.route, g.stop);
      p.phase = current.inside ? 'inside' : 'outbound';
      p.phaseAt = current.nextAt;
      p.working = false;
      p.actor.path = g.route;
      p.actor.speed = 0.75;
      p.actor.direction = 1;
      p.actor.distance = pathLength(g.route) * current.progress;
      p.actor.position = sampleWorkerPath(g.route, p.actor.distance);
      p.actor.done = current.inside;
      p.actor.startAt = now;
      p.actor.visible = !current.inside;
      p.last = { ...p.actor.position };
      p.previous = { ...p.actor.position };
      return;
    }
    if (now >= m.completesAt + WORKER_REBUILD_MS) {
      p.phase = 'done';
      return;
    }
    if (m.stops?.length) {
      const last = m.stops[m.stops.length - 1]!;
      if (now >= m.startedAt + last.workEndsAfterMs) {
        p.phase = 'inbound';
        p.actor.direction = -1;
        p.actor.path = this.#backRoute(g);
        const duration = Math.max(1, m.completesAt - m.startedAt - last.workEndsAfterMs);
        p.actor.speed = pathLength(p.actor.path) / (duration / 1000);
        p.actor.distance = Math.min(
          pathLength(p.actor.path),
          (p.actor.speed * (now - m.startedAt - last.workEndsAfterMs)) / 1000,
        );
        p.actor.startAt = now;
      } else {
        g.stop = m.stops.findIndex((s) => now < m.startedAt + s.workEndsAfterMs);
        const stop = m.stops[g.stop]!;
        g.route = this.#route(m, g.stop);
        g.layout = this.#layout(m, g.route, g.stop);
        const legStart = m.stops[g.stop - 1]?.workEndsAfterMs ?? 0,
          legMs = Math.max(1, stop.arrivesAfterMs - legStart);
        p.arrivedAt = m.startedAt + stop.arrivesAfterMs;
        p.actor.direction = 1;
        p.actor.member = 0;
        p.actor.rank = 0;
        p.actor.startAt = now;
        if (now < m.startedAt + stop.arrivesAfterMs) {
          p.phase = 'outbound';
          p.actor.path = g.route;
          p.actor.speed = pathLength(g.route) / (legMs / 1000);
          p.actor.distance = Math.max(0, (p.actor.speed * (now - m.startedAt - legStart)) / 1000);
        } else {
          p.phase = 'work';
          p.actor.position = { ...this.#post(p, g, now, true) };
          p.actor.done = true;
          p.actor.visible = true;
          p.working = true;
        }
      }
      if (p.phase !== 'work') p.actor.position = sampleWorkerPath(p.actor.path, p.actor.distance);
      p.last = { ...p.actor.position };
      p.previous = { ...p.actor.position };
      return;
    }
    if (now >= backStart) {
      p.phase = 'inbound';
      p.actor.direction = -1;
      p.actor.path = this.#backRoute(g);
      p.actor.distance = Math.max(
        0,
        Math.min(pathLength(g.route), (p.actor.speed * (now - backStart)) / 1000 - Math.floor(p.index / 2) * 0.52),
      );
      p.actor.startAt = now;
    } else if (now >= outEnd) {
      p.phase = 'work';
      p.phaseAt = now;
      p.arrivedAt = outEnd;
      p.actor.position = { ...this.#post(p, g, now, true) };
      p.actor.visible = true;
      p.actor.member = 0;
      p.actor.done = true;
    } else {
      p.phase = 'outbound';
      p.actor.path = g.route;
      p.actor.direction = 1;
      p.actor.distance = Math.max(0, (p.actor.speed * (now - m.startedAt)) / 1000 - Math.floor(p.index / 2) * 0.52);
      p.actor.startAt = Math.max(now, m.startedAt + Math.floor(p.index / 2) * 230);
    }
    if (p.phase === 'outbound' || p.phase === 'inbound')
      p.actor.position = sampleWorkerPath(p.actor.path, p.actor.distance);
    p.last = { ...p.actor.position };
    p.previous = { ...p.actor.position };
  }
  /** Homeward route: the same road, entering the hall by its entry lane. */
  #backRoute(g: Group): WorkerPoint[] {
    if (g.mission.returnPath?.length)
      return this.hooks
        .path([...g.mission.returnPath].reverse(), 'in')
        .reverse()
        .map((v) => this.#point(v, v.width));
    return [...this.#route(g.mission, g.stop, 'in')].reverse();
  }
  /**
   * A retrace that reaches the door switches to the entry lane: the exit lane
   * is walked outward only.
   */
  #homeward(retrace: WorkerPoint[], back: WorkerPoint[]): WorkerPoint[] {
    const first = retrace.findIndex((q) => q.lane),
      lane = back.findIndex((q) => q.lane);
    return first < 0 || lane < 0 ? retrace : [...retrace.slice(0, first), ...back.slice(lane)];
  }
  #post(p: Person, g: Group, now: number, everyone = false): WorkerPoint {
    if (g.mission.resource === 'garden') {
      const stop = g.mission.stops?.[g.stop],
        start = g.mission.startedAt + (stop?.arrivesAfterMs ?? g.mission.transportMs);
      const end = stop ? g.mission.startedAt + stop.workEndsAfterMs : g.mission.completesAt - g.mission.transportMs;
      p.harvestProgress ??= Math.max(0, Math.min(1, (now - start) / Math.max(1, end - start)));
      p.working = true;
      return gardenHarvestPoint(g.layout.stations[p.index]!, gardenStride(p.harvestProgress, (end - start) / 1000));
    }
    const station = g.layout.stations[p.index]!;
    if (!station.workAt || !station.slot) {
      p.working = g.layout.variant !== 'blocked';
      return station;
    }
    const peers = g.people.filter((v) => g.layout.stations[v.index]!.slot === station.slot);
    // Two seconds empty between turns gives the outgoing worker room to leave.
    const elapsed = Math.max(0, now - g.mission.startedAt - g.mission.transportMs),
      turn = Math.floor(elapsed / 12_000),
      turnStart = g.mission.startedAt + g.mission.transportMs + turn * 12_000,
      chosen = peers[turn % Math.max(1, peers.length)];
    // Arrivals feed the post before its queue: until the chosen peer is there,
    // the first one present works, and a turn never swaps its holder.
    const present = everyone ? peers : peers.filter((v) => ['install', 'work', 'rotate', 'load'].includes(v.phase));
    const settled = present.filter((v) => v.arrivedAt <= turnStart),
      pool = settled.length ? settled : present.length ? present : [p];
    const holder =
      chosen && pool.includes(chosen)
        ? chosen
        : pool.reduce<Person | undefined>(
            (best, v) =>
              !best || v.arrivedAt < best.arrivedAt || (v.arrivedAt === best.arrivedAt && v.index < best.index)
                ? v
                : best,
            undefined,
          );
    p.working = elapsed % 12_000 >= 2_000 && holder === p;
    return p.working ? station.workAt : station;
  }
  #props(g: Group, felled: FelledTree | null = null) {
    const m = g.mission;
    if (m.resource === 'garden' || m.resource === 'idle' || m.resource === 'survey' || m.resource === 'trade') return;
    // Posts move around the real tree before the saws and blocks are placed.
    const plan = m.resource === 'wood' ? this.#woodPlan(g, felled) : null;
    const sawPairs = new Map<number, WorkerPoint[]>();
    for (const s of g.layout.stations)
      if (s.role === 'saw' && (g.layout.variant !== 'compact' || s.pair === 0)) {
        const points = sawPairs.get(s.pair) ?? [];
        points.push(s.workAt ?? s);
        sawPairs.set(s.pair, points);
      }
    for (const [pair, points] of sawPairs) {
      if (points.length < 2) continue;
      const a = points[0]!,
        b = points[1]!,
        x = (a.x + b.x) / 2,
        z = (a.z + b.z) / 2;
      // The saw lies on the line between the sawyers, its handles in their hands.
      const length = Math.hypot(a.x - b.x, a.z - b.z),
        ux = (b.x - a.x) / length,
        uz = (b.z - a.z) / length,
        blade = length - 2 * SAW_GRIP.reach;
      const saw = this.#box(
        `saw-${m.id}-${pair}`,
        blade,
        SAW_BLADE.height,
        0.012,
        x,
        SAW_BLADE.y,
        z,
        this.materials.stone,
        g.root,
      );
      saw.rotation.y = -Math.atan2(uz, ux);
      saw.metadata = { x, z, ux, uz, pair };
      // Crosswise handles, in the blade's scaled frame.
      for (const end of [-1, 1])
        this.#box(
          `saw-${m.id}-${pair}-handle-${end}`,
          0.025 / blade,
          0.035 / SAW_BLADE.height,
          0.34 / 0.012,
          end * 0.5,
          (SAW_GRIP.height - SAW_BLADE.y) / SAW_BLADE.height,
          0,
          this.materials.timber,
          saw,
        );
      g.saws.push(saw);
      // Pair 0 saws the felled tree itself: no sawhorse trunk.
      if (plan?.pair0.length && pair === 0) continue;
      const trunk = MeshBuilder.CreateCylinder(
        `work-trunk-${m.id}-${pair}`,
        { height: 0.9, diameter: 0.19, tessellation: 6 },
        this.scene,
      );
      trunk.parent = g.root;
      // Across the saw line, its top under the blade.
      trunk.rotation.set(Math.PI / 2, -Math.atan2(uz, ux), 0);
      trunk.position.set(x, 0.28, z);
      trunk.material = this.materials.timber;
      trunk.isPickable = false;
      g.blocks.push(trunk);
    }
    const owned = new Set<string>();
    for (const [i, s] of g.layout.stations.entries())
      if (
        (['wood-chop', 'break', 'carry'].includes(s.role) ||
          (m.resource === 'wood' && m.count <= 2 && i === 0) ||
          (m.resource === 'stone' && m.count === 1)) &&
        (!s.slot || !owned.has(s.slot))
      ) {
        if (s.slot) owned.add(s.slot);
        const at = s.workAt ?? s;
        const block = this.#box(
          `work-block-${m.id}-${i}`,
          0.23,
          0.15,
          0.25,
          at.x + Math.sin(s.facing) * 0.32,
          0.12,
          at.z + Math.cos(s.facing) * 0.32,
          m.resource === 'wood' ? this.materials.timber : this.materials.stone,
          g.root,
        );
        block.metadata = { station: i };
        g.blocks.push(block);
      }
    if (m.resource === 'wood') g.wood = this.#woodProps(g, plan);
    g.root.setEnabled(false);
  }
  /**
   * The whole wood site works around the real grove tree (layout from the
   * scene's designer, 28 October): a lone axe in front of it; saw pair 0 fells
   * it across its saw line, then cuts the trunk where it lies, a step closer
   * at each section; the other pairs' sawhorses after the trunk's end and the
   * chopping blocks on the clearing side. The tree falls along the forest edge
   * on its free side, else into the clearing. Any post that is not free keeps
   * its template place, for that role only. Presentation only.
   */
  #woodPlan(g: Group, previous: FelledTree | null): WoodPlan | null {
    const stations = g.layout.stations,
      featureId = g.mission.featureId,
      axe = stations.findIndex((s) => s.role === 'axe'),
      first = stations.findIndex((s) => s.role === 'saw' && s.pair === 0),
      feller = axe >= 0 ? axe : first >= 0 ? first : 0,
      station = stations[feller];
    if (!station || !featureId) return null;
    const at = station.workAt ?? station,
      root = g.root.position;
    const tree = previous ?? this.hooks.fellTree?.(featureId, { x: at.x + root.x, z: at.z + root.z }, g.mission.id);
    if (!tree) {
      this.#woodPlans.set(g.mission.id, { kind: 'nul', fall: null });
      return null;
    }
    const base = { x: tree.x - root.x, z: tree.z - root.z },
      add = (p: WorkerPoint, d: WorkerPoint, k: number) => ({ x: p.x + d.x * k, z: p.z + d.z * k }),
      free = (p: WorkerPoint, r = 0.2) =>
        this.hooks.stageFree
          ? this.hooks.stageFree({ x: p.x + root.x, z: p.z + root.z }, r)
          : this.hooks.free({ x: p.x + root.x, z: p.z + root.z }, r, featureId, true);
    const towards = (from: WorkerPoint, to: WorkerPoint) => {
      const length = Math.hypot(to.x - from.x, to.z - from.z) || 1;
      return { x: (to.x - from.x) / length, z: (to.z - from.z) / length };
    };
    const turn = (d: WorkerPoint, angle: number) => ({
      x: d.x * Math.cos(angle) - d.z * Math.sin(angle),
      z: d.x * Math.sin(angle) + d.z * Math.cos(angle),
    });
    // A: from the foot towards the clearing; L: along the forest edge.
    const clearing = towards(
        base,
        Math.hypot(g.layout.approach.x - base.x, g.layout.approach.z - base.z) > 0.1 ? g.layout.approach : at,
      ),
      edge = { x: clearing.z, z: -clearing.x },
      length = trunkTop(tree.variant) * tree.heightScale;
    // The clearest of 16 directions over the trunk's length; on a tie, along
    // the forest edge (readable from the usual camera), then into the clearing.
    const room = (d: WorkerPoint) => {
      let n = 0;
      for (let k = 0.4; k <= length + 1e-6; k += 0.4, n++) if (!free(add(base, d, k), 0.25)) break;
      return n;
    };
    let fall = clearing,
      best = -1;
    for (let i = 0; i < 16; i++) {
      const d = turn(clearing, (i * Math.PI) / 8),
        score = room(d) * 10 + Math.abs(d.x * edge.x + d.z * edge.z) * 2 + (d.x * clearing.x + d.z * clearing.z);
      if (score > best + 1e-9) {
        best = score;
        fall = d;
      }
    }
    // Installation walks to the station itself; work checks its workAt: move both.
    const face = (s: WorkStation, post: WorkerPoint, toward: WorkerPoint) => {
      s.x = post.x;
      s.z = post.z;
      s.workAt = post;
      s.facing = Math.atan2(toward.x - post.x, toward.z - post.z);
    };
    let kind: WoodPlanState['kind'] = 'arbre-seul';
    if (axe >= 0 && tree.lying === 0)
      for (let i = 0; i < 16; i++) {
        const post = add(base, turn(clearing, (i * Math.PI) / 8), 0.6);
        if (free(post)) {
          face(stations[axe]!, post, base);
          break;
        }
      }
    // Saw pair 0 across its fall at the foot: the saw line turns by 15° steps
    // until both posts are free. It never goes back to a sawhorse trunk.
    const pair0 = stations.flatMap((s, i) => (s.role === 'saw' && s.pair === 0 ? [i] : []));
    let across = { x: fall.z, z: -fall.x };
    if (pair0.length === 2) {
      const start = tree.lying > 0 ? add(base, fall, length * tree.lying * (5 / 6)) : base;
      let placed = false;
      for (let i = 0; i < 12 && !placed; i++) {
        const line = turn(across, (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.PI / 12)),
          a = add(start, line, 0.49),
          b = add(start, line, -0.49);
        if (free(a) && free(b)) {
          face(stations[pair0[0]!]!, a, start);
          face(stations[pair0[1]!]!, b, start);
          across = line;
          placed = true;
        }
      }
      kind = placed ? 'binome' : 'binome-sans-place';
    }
    // The other pairs' sawhorses after the trunk's end, perpendicular to the fall.
    for (const pair of [...new Set(stations.filter((s) => s.role === 'saw' && s.pair > 0).map((s) => s.pair))]) {
      const indices = stations.flatMap((s, i) => (s.role === 'saw' && s.pair === pair ? [i] : []));
      if (indices.length !== 2) continue;
      const centre = add(add(base, fall, length + 0.6 + 0.9 * (pair - 1)), clearing, 0.35),
        a = add(centre, fall, -0.49),
        b = add(centre, fall, 0.49);
      if (free(a) && free(b)) {
        face(stations[indices[0]!]!, a, centre);
        face(stations[indices[1]!]!, b, centre);
      }
    }
    // Chopping blocks on the clearing side, halfway along the trunk.
    let k = 0;
    for (const s of stations)
      if (s.role === 'wood-chop') {
        const block = add(add(base, fall, length / 2), clearing, 1.1 + 0.6 * k++),
          post = add(block, clearing, 0.32);
        if (free(post) && free(block, 0.15)) face(s, post, block);
      }
    this.#woodPlans.set(g.mission.id, { kind, fall: Math.round((Math.atan2(fall.x, fall.z) * 180) / Math.PI) });
    return { tree, base, fall, across, length, pair0 };
  }
  /**
   * Draws the planned grove tree from the same kit pieces, at the same place,
   * scale and turn, hidden in the grove meanwhile. The pile waits beside the
   * road end.
   */
  #woodProps(g: Group, plan: WoodPlan | null): WoodProps | null {
    const stations = g.layout.stations,
      axe = stations.findIndex((s) => s.role === 'axe'),
      first = stations.findIndex((s) => s.role === 'saw' && s.pair === 0);
    const feller = axe >= 0 ? axe : first >= 0 ? first : 0;
    if (!stations[feller]) return null;
    const target = this.hooks.project(g.mission.target);
    let heading: TransformNode | null = null,
      tilt: TransformNode | null = null,
      trunk: Mesh | null = null,
      crown: Mesh | null = null;
    const base = plan?.base ?? stations[feller]!.workAt ?? stations[feller]!;
    if (plan) {
      const { tree, fall } = plan;
      heading = new TransformNode(`wood-tree-${g.mission.id}`, this.scene);
      heading.parent = g.root;
      heading.position.set(base.x, 0, base.z);
      const fallAngle = Math.atan2(fall.x, fall.z);
      heading.rotation.y = fallAngle;
      tilt = new TransformNode(`wood-tree-tilt-${g.mission.id}`, this.scene);
      tilt.parent = heading;
      // Its own turn, as drawn in the grove.
      const own = new TransformNode(`wood-tree-own-${g.mission.id}`, this.scene);
      own.parent = tilt;
      own.rotation.y = tree.yaw - fallAngle;
      own.scaling.set(tree.scale, tree.heightScale, tree.scale);
      const piece = (name: string, kind: 'fut' | 'feuillage') => {
        const mesh = new BabylonMesh(name, this.scene);
        treePieceData(`${tree.variant}-${kind}`).applyToMesh(mesh);
        mesh.parent = own;
        mesh.material = this.materials.white;
        mesh.isPickable = false;
        return mesh;
      };
      trunk = piece(`wood-tree-trunk-${g.mission.id}`, 'fut');
      crown = piece(`wood-tree-crown-${g.mission.id}`, 'feuillage');
    }
    // Beside the road end, crosswise to the arrival.
    const approach = g.layout.approach,
      ax = target.x - approach.x,
      az = target.z - approach.z,
      length = Math.hypot(ax, az) || 1;
    const side = { x: -az / length, z: ax / length },
      pile = { x: approach.x + side.x * 0.7, z: approach.z + side.z * 0.7 };
    const logs: Mesh[] = [];
    for (let i = 0; i < PILE_LOGS; i++) {
      const slot = pileSlot(i),
        log = this.#box(
          `wood-pile-${g.mission.id}-${i}`,
          PILE_LOG.diameter,
          PILE_LOG.diameter,
          PILE_LOG.length,
          pile.x + side.x * slot.along * PILE_LOG.diameter * 1.1,
          0,
          pile.z + side.z * slot.along * PILE_LOG.diameter * 1.1,
          this.materials.timber,
          g.root,
        );
      log.rotation.y = Math.atan2(ax, az);
      log.metadata = { level: slot.level };
      logs.push(log);
    }
    return { heading, tilt, trunk, crown, tree: plan?.tree ?? null, plan, logs, base, pile, feller, fellerAt: null };
  }

  reproject() {
    for (const g of this.#groups.values()) {
      if (g.mission.leisure) continue; // Canonical spokes are refreshed by sync; shift translates live paths.
      const prior = g.route[0]!,
        route = this.#route(g.mission, g.stop),
        shift = { x: prior.x - route[0]!.x, z: prior.z - route[0]!.z };
      for (const p of g.people) {
        p.actor.position.x -= shift.x;
        p.actor.position.z -= shift.z;
        p.last.x -= shift.x;
        p.last.z -= shift.z;
        p.previous.x -= shift.x;
        p.previous.z -= shift.z;
      }
      const routeChanged = JSON.stringify(g.route) !== JSON.stringify(route);
      g.route = route;
      const oldLayout = g.layout;
      g.layout = this.#layout(g.mission, route, g.stop);
      if (routeChanged)
        for (const p of g.people) {
          if (p.phase === 'outbound') this.#reroute(p, route);
          else if (p.phase === 'inbound') this.#reroute(p, this.#backRoute(g));
        }
      // Props retain their local template; translate only on coordinate rebasing.
      g.root.position.x -= shift.x;
      g.root.position.z -= shift.z;
      if (JSON.stringify(oldLayout.stations) !== JSON.stringify(g.layout.stations)) {
        for (const mesh of g.root.getChildMeshes()) mesh.dispose(false, false);
        // A rebuilt layout keeps when the feller arrived: the tree never stands up again.
        const fellerAt = g.wood?.fellerAt ?? null,
          felled = g.wood?.tree ?? null;
        g.wood?.heading?.dispose(false, false);
        g.wood = null;
        g.saws = [];
        g.blocks = [];
        g.root.position.setAll(0);
        this.#props(g, felled);
        const wood = g.wood as WoodProps | null;
        if (wood) wood.fellerAt = fellerAt;
        for (const p of g.people)
          if (p.phase === 'work') {
            const destination = this.#post(p, g, this.#lastNow ?? g.createdAt);
            const connector = worksiteConnector(
              p.actor.position,
              destination,
              this.hooks.project(g.mission.target),
              (q, r) => this.#connectorFree(p, g, q, r),
              this.#connectorPosts(p, g),
            );
            if (connector) {
              p.phase = 'rotate';
              p.actor.path = connector;
              p.actor.distance = 0;
              p.actor.member = 0;
              p.actor.formation = 0;
              p.actor.lateral = 0;
              p.actor.done = false;
              p.actor.speed = 1;
              p.actor.startAt = this.#lastNow ?? g.createdAt;
              p.actor.local = true;
            }
          }
      }
    }
    this.#graphDirty = true;
  }
  shift(x: number, z: number) {
    for (const g of this.#groups.values()) {
      // Connector endpoints can alias route points or stations; translate once.
      const points = new Set<WorkerPoint>([
        ...g.route,
        ...g.layout.stations,
        g.layout.approach,
        ...(g.mission.leisure?.flatMap((l) => l.path) ?? []),
        ...g.people.flatMap((p) => p.actor.path),
        ...g.layout.stations.flatMap((s) => (s.workAt ? [s.workAt] : [])),
      ]);
      for (const q of points) {
        q.x -= x;
        q.z -= z;
      }
      g.root.position.x -= x;
      g.root.position.z -= z;
      for (const p of g.people) {
        p.actor.position.x -= x;
        p.actor.position.z -= z;
        p.last.x -= x;
        p.last.z -= z;
        p.previous.x -= x;
        p.previous.z -= z;
        p.root.position.x -= x;
        p.root.position.z -= z;
      }
    }
    this.#graphDirty = true;
  }

  #reservedPosts(p: Person, g: Group) {
    let layout = this.#reservedLayouts.get(g.layout);
    if (!layout) {
      layout = new Map();
      this.#reservedLayouts.set(g.layout, layout);
    }
    let posts = layout.get(p.index);
    if (!posts) {
      const own = g.layout.stations[p.index]!;
      posts = g.layout.stations
        .filter((s, i) => i !== p.index && !(g.layout.variant === 'compact' && s.slot === own.slot))
        .map((s) => (g.layout.variant === 'compact' ? (s.workAt ?? s) : s));
      posts = [...new Map(posts.map((s) => [`${s.x}:${s.z}`, s])).values()];
      layout.set(p.index, posts);
    }
    return posts;
  }
  /**
   * Exits take a small body margin: sampled every 0.2 m, a connector can graze
   * a teammate's post between two samples, at a distance the swept step check
   * then refuses for good.
   */
  #connectorFree(p: Person, g: Group, point: WorkerPoint, radius: number, margin = 0) {
    return (
      this.#reservedPosts(p, g).every((s) => Math.hypot(point.x - s.x, point.z - s.z) >= radius + 0.24) &&
      g.people.every(
        (other) =>
          other === p ||
          !other.actor.visible ||
          Math.hypot(point.x - other.actor.position.x, point.z - other.actor.position.z) >= WORKER_CLEARANCE + margin,
      ) &&
      this.hooks.free(point, radius, g.mission.featureId, true)
    );
  }
  #connectorPosts(p: Person, g: Group) {
    const neighbours = g.people.filter((other) => other !== p && other.actor.visible);
    return [...this.#reservedPosts(p, g), ...neighbours.map((other) => other.actor.position)];
  }
  /** Road left to walk, the rear member of a rank counted from its leader. */
  #remaining(p: Person) {
    const a = p.actor;
    return pathLength(a.path) - a.distance + (a.member ?? 0) * 0.5 * Math.cos(((a.formation ?? 0) * Math.PI) / 2);
  }
  /** On a compact site, the foremost teammate on the road installs next, 1.5 m behind the previous one. */
  #nextInstaller(p: Person, g: Group) {
    const remaining = this.#remaining(p);
    return g.people.every((other) => {
      if (other === p) return true;
      if (other.phase === 'install') return other.actor.distance >= WORKER_CLEARANCE * 2;
      if (other.phase !== 'outbound' || !other.actor.visible) return true;
      const ahead = remaining - this.#remaining(other);
      return ahead <= 0 || ahead >= 1.5;
    });
  }
  #returnSpeed(g: Group, back: WorkerPoint[]) {
    const m = g.mission,
      returnAt = m.stops?.length
        ? m.startedAt + m.stops[m.stops.length - 1]!.workEndsAfterMs
        : m.completesAt - m.transportMs;
    return Math.max(
      0.8,
      pathLength(back) / Math.max(0.5, (m.stops?.length ? m.completesAt - returnAt : m.transportMs) / 1000),
    );
  }
  /** The closest point of the return route and the route beyond it. */
  #roadJoin(position: WorkerPoint, back: WorkerPoint[]) {
    let best = {
        point: back[0]!,
        tail: back.slice(1),
        along: 0,
        gap: Math.hypot(position.x - back[0]!.x, position.z - back[0]!.z),
      },
      along = 0;
    for (let i = 1; i < back.length; i++) {
      const a = back[i - 1]!,
        b = back[i]!,
        dx = b.x - a.x,
        dz = b.z - a.z,
        length = Math.hypot(dx, dz);
      const t =
        length > 0
          ? Math.max(0, Math.min(1, ((position.x - a.x) * dx + (position.z - a.z) * dz) / (length * length)))
          : 0;
      const point = t >= 1 ? b : { x: a.x + dx * t, z: a.z + dz * t },
        gap = Math.hypot(position.x - point.x, position.z - point.z);
      if (gap < best.gap - 0.01) best = { point, tail: back.slice(t >= 1 ? i + 1 : i), along: along + length * t, gap };
      along += length;
    }
    return best;
  }
  /**
   * The place joining the road furthest down it leaves first: every later
   * departure joins the convoy behind it, never ahead of a teammate's exit.
   */
  #nextLeaver(p: Person, g: Group, back: WorkerPoint[], now: number) {
    const order = (q: Person) => {
      const join = this.#roadJoin(q.actor.position, back);
      return [-join.along, join.gap, q.index];
    };
    const mine = order(p);
    return g.people.every((other) => {
      // A teammate whose own departure just failed yields its turn meanwhile.
      if (other === p || other.phase !== 'load' || other.connectorRetry > now) return true;
      const theirs = order(other);
      for (let i = 0; i < 3; i++) if (theirs[i] !== mine[i]) return theirs[i]! > mine[i]!;
      return true;
    });
  }
  /**
   * A departure keeps body clearance from every teammate already walking home,
   * at the convoy's known paces: the exit connector at 1.6 m/s, the road at the
   * return speed. Two exits meeting head-on or converging within clearance would
   * each deny the other's step for good; exits that stay apart leave together.
   */
  #spacedDeparture(p: Person, g: Group, path: WorkerPoint[], exit: number, back: WorkerPoint[]) {
    const roadSpeed = this.#returnSpeed(g, back),
      exitSpeed = 1.6;
    const along = (start: number, fastUntil: number, fast: number, slow: number, t: number) => {
      if (start >= fastUntil) return start + slow * t;
      const fastTime = (fastUntil - start) / fast;
      return t <= fastTime ? start + fast * t : fastUntil + slow * (t - fastTime);
    };
    // Past that point the walk is a road walk in the convoy's direction: a
    // slower teammate ahead is followed, never met.
    const mineUntil = pathLength(path.slice(0, exit)) + WORKER_CLEARANCE * 2,
      horizon = mineUntil / exitSpeed;
    const walking = g.people.filter(
      (other) => other !== p && other.phase === 'inbound' && other.actor.visible && !other.actor.done,
    );
    for (const other of walking) {
      const a = other.actor,
        offset = (a.member ?? 0) * 0.5 * Math.cos(((a.formation ?? 0) * Math.PI) / 2),
        theirsUntil = other.exit ? pathLength(a.path.slice(0, other.exit)) + WORKER_CLEARANCE * 2 : -Infinity,
        theirSlow = other.exit ? roadSpeed : a.speed;
      for (let t = 0; t <= horizon; t += WORKER_STEP) {
        const mine = sampleWorkerPath(path, along(0, mineUntil, exitSpeed, roadSpeed, t)),
          theirs = sampleWorkerPath(a.path, along(a.distance, theirsUntil, a.speed, theirSlow, t) - offset);
        if (Math.hypot(mine.x - theirs.x, mine.z - theirs.z) < WORKER_CLEARANCE + 0.1) return false;
      }
    }
    return true;
  }
  /** Retrace the road already walked, back to the door. */
  #turnBack(p: Person, g: Group, now: number) {
    const a = p.actor;
    if (!a.visible) {
      p.phase = 'done';
      a.done = true;
      return;
    }
    const distance = Math.max(0, a.distance - (a.member ?? 0) * 0.5 * Math.cos(((a.formation ?? 0) * Math.PI) / 2));
    let length = 0,
      segment = 1;
    for (; segment < a.path.length; segment++) {
      length += pathLength(a.path.slice(segment - 1, segment + 1));
      if (length >= distance) break;
    }
    const back = this.#backRoute(g);
    p.phase = 'inbound';
    p.phaseAt = now;
    a.path = this.#homeward([{ ...a.position }, ...a.path.slice(0, segment).reverse()], back);
    a.distance = 0;
    a.done = false;
    a.member = 0;
    a.formation = 0;
    a.lateral = 0;
    a.waitingSince = null;
    a.startAt = now;
    a.direction = -1;
    a.rank = Math.floor(p.index / 2);
    a.local = false;
    a.speed = this.#returnSpeed(g, back);
  }
  /**
   * An exit whose road join is taken steps back to its own station, clear of
   * the road, then leaves again once the convoy has passed. A teammate who
   * walked up the road behind a delayed exit stops within body clearance of
   * its join, diagonally: neither step shortens the gap, nothing moves again.
   */
  #retreat(p: Person, g: Group, now: number) {
    const a = p.actor,
      station = g.layout.stations[p.index]!;
    let length = 0,
      segment = 1;
    for (; segment < p.exit; segment++) {
      length += pathLength(a.path.slice(segment - 1, segment + 1));
      if (length >= a.distance) break;
    }
    // Without a way back to the station, retrace the connector walked so far.
    const connector = worksiteConnector(
      a.position,
      station,
      this.hooks.project(g.mission.target),
      (q, r) => this.#connectorFree(p, g, q, r, EXIT_MARGIN),
      this.#connectorPosts(p, g),
    );
    p.phase = 'rotate';
    p.phaseAt = now;
    p.exit = 0;
    a.path = connector ?? [{ ...a.position }, ...a.path.slice(0, segment).reverse()];
    a.distance = 0;
    a.done = false;
    a.member = 0;
    a.formation = 0;
    a.lateral = 0;
    a.waitingSince = null;
    a.startAt = now;
    a.direction = 1;
    a.rank = 100 + p.index;
    a.local = true;
    a.speed = 1.6;
  }
  #installationDistance(g: Group) {
    let distance = this.#installationDistances.get(g.layout);
    if (distance === undefined) {
      const target = this.hooks.project(g.mission.target);
      // Leave the shared road before an occupied work/waiting post can stop the next
      // teammate just outside the old fixed 1.5 m connector threshold.
      distance = Math.max(
        1.5,
        ...g.layout.stations
          .flatMap((s) => (s.workAt ? [s, s.workAt] : [s]))
          .map((s) => Math.hypot(s.x - target.x, s.z - target.z) + WORKER_CLEARANCE),
      );
      // Terrassiers work beside the reserved pad, potentially at the final
      // road bend. Leave before the traffic gate's one-metre exit clearance
      // sees a teammate already working there.
      if (g.mission.resource === 'leveling') distance += 1;
      this.#installationDistances.set(g.layout, distance);
    }
    return distance;
  }
  #transition(p: Person, g: Group, now: number) {
    const station = g.layout.stations[p.index]!,
      m = g.mission;
    if (m.resource === 'trade') {
      this.#reconstructPerson(p, g, now);
      p.actor.visible = now >= m.startedAt && now < m.completesAt;
      if (now >= m.completesAt) {
        p.phase = 'done';
        p.actor.visible = false;
      }
      p.cargo.setEnabled(p.actor.visible);
      return;
    }
    if (m.leisure) {
      if (p.phase === 'outbound' && p.actor.done) {
        p.phase = 'inside';
        p.phaseAt = now + m.leisure[g.stop]!.insideMs;
        p.actor.visible = false;
      }
      if (p.phase === 'inside' && now >= p.phaseAt) {
        const reached = m.leisure[g.stop]!.to,
          next = this.#latest.get(m.key);
        const itinerary = next?.leisure ?? m.leisure,
          leg = itinerary.findIndex((l) => l.from === reached);
        if (leg < 0) {
          p.phase = 'done';
          p.valid = false;
          return;
        }
        g.mission = next ?? m;
        g.stop = leg;
        g.route = this.#route(g.mission, leg);
        g.layout = this.#layout(g.mission, g.route, leg);
        const door = g.route[0]!,
          indoors = p.actor.path[p.actor.path.length - 1];
        // Indoors behind a double door, the next leg starts on the exit lane.
        if (indoors?.lane && door.lane) p.actor.position = { x: door.x, z: door.z };
        // A changed doorway needs a real connector; retain the reached position.
        if (Math.hypot(door.x - p.actor.position.x, door.z - p.actor.position.z) > 0.01) {
          const connector = worksiteConnector(p.actor.position, door, door, (q, r) => this.hooks.free(q, r, null));
          if (!connector) {
            p.phaseAt = now + 1000;
            return;
          }
          g.route = [...connector, ...g.route.slice(1)];
        }
        p.phase = 'outbound';
        p.phaseAt = now;
        p.actor.path = g.route;
        p.actor.distance = 0;
        p.actor.done = false;
        p.actor.visible = true;
        p.actor.startAt = now;
        p.actor.speed = 0.75;
        p.actor.member = 0;
        p.actor.formation = 0;
        p.actor.lateral = 0;
        p.actor.waitingSince = null;
        this.#graphDirty = true;
      }
      return;
    }
    const returnAt = m.stops?.length
      ? m.startedAt + m.stops[m.stops.length - 1]!.workEndsAfterMs
      : m.completesAt - m.transportMs;
    const extraction = ['wood', 'stone', 'leveling'].includes(m.resource);
    // A latecomer still on the road when the team leaves joins the return from
    // where it stands, empty-handed, instead of walking in only to walk out loaded.
    if (extraction && !m.stops?.length && now >= returnAt && p.phase === 'outbound') this.#turnBack(p, g, now);
    const roadArrival =
      p.actor.done || (extraction && p.actor.visible && this.#remaining(p) <= this.#installationDistance(g));
    if (p.phase === 'outbound' && roadArrival) {
      // A compact site admits one installation at a time, the foremost teammate
      // first. The others wait in sight on the road, clear of every post,
      // instead of unseen at the door until the previous one has walked it all.
      // The admitted one leaves the road where it passes closest to its place.
      const compact = g.layout.variant === 'compact',
        destination = compact ? this.#post(p, g, now) : station;
      if (compact) {
        if (!this.#nextInstaller(p, g)) {
          p.actor.startAt = now + WORKER_STEP * 1000;
          return;
        }
        if (!p.actor.done && this.#remaining(p) > this.#roadJoin(destination, this.#backRoute(g)).along + 0.05) return;
      }
      if (now >= p.connectorRetry) {
        const from = { ...p.actor.position },
          target = this.hooks.project(m.target);
        const connector =
          m.resource === 'garden' || m.resource === 'survey'
            ? [from, destination]
            : worksiteConnector(
                from,
                destination,
                target,
                (q, r) => this.#connectorFree(p, g, q, r),
                this.#connectorPosts(p, g),
              );
        if (connector) {
          p.phase = 'install';
          p.phaseAt = now;
          p.arrivedAt = now;
          p.harvestProgress = 0;
          p.actor.waitingSince = null;
          p.actor.path = connector;
          p.actor.distance = 0;
          p.actor.done = false;
          p.actor.member = 0;
          p.actor.formation = 0;
          p.actor.startAt = now;
          p.actor.rank = 100 + p.index;
          p.actor.local = true;
          p.actor.speed = 1.6;
        } else {
          p.connectorRetry = now + 1000;
          p.actor.waitingSince ??= now;
        }
      }
      if (p.phase === 'outbound') return; // Keep walking to the road end and retry from there.
    } else if ((p.phase === 'install' || p.phase === 'rotate') && p.actor.done) {
      p.phase = 'work';
      p.phaseAt = now;
      p.worked ||= now < returnAt;
    }
    // A connector blocked for 1.5 s is planned again around the bodies now
    // present: on the way to a post, and on the way out before the road.
    const leaving = p.phase === 'inbound' && p.exit > 0 && p.actor.distance < pathLength(p.actor.path.slice(0, p.exit));
    if (leaving && p.actor.waitingSince !== null && now - p.actor.waitingSince >= 3000) {
      // Planned again and still not one step: the way out is held by a teammate
      // who is waiting on this exit in turn.
      this.#retreat(p, g, now);
    } else if (
      (p.phase === 'install' || p.phase === 'rotate' || leaving) &&
      extraction &&
      p.actor.waitingSince !== null &&
      now - p.actor.waitingSince >= 1500 &&
      now >= p.connectorRetry
    ) {
      p.connectorRetry = now + 1500;
      const goal = leaving ? p.actor.path[p.exit - 1]! : p.actor.path.at(-1)!,
        connector = worksiteConnector(
          p.actor.position,
          goal,
          this.hooks.project(m.target),
          (q, r) => this.#connectorFree(p, g, q, r, leaving ? EXIT_MARGIN : 0),
          this.#connectorPosts(p, g),
        );
      if (connector) {
        p.actor.path = leaving ? [...connector, ...p.actor.path.slice(p.exit)] : connector;
        if (leaving) p.exit = connector.length;
        p.actor.distance = 0;
        p.actor.member = 0;
        p.actor.formation = 0;
        p.actor.lateral = 0;
        p.actor.startAt = now;
        this.#graphDirty = true;
      } else if (leaving) this.#retreat(p, g, now);
    }
    if (p.phase === 'work' && m.resource === 'garden') {
      const stop = m.stops?.[g.stop],
        duration = stop ? stop.workEndsAfterMs - stop.arrivesAfterMs : m.completesAt - m.startedAt - m.transportMs * 2;
      p.harvestProgress = Math.min(1, (p.harvestProgress ?? 0) + (WORKER_STEP * 1000) / Math.max(1, duration));
      p.actor.position = this.#post(p, g, now);
      p.actor.visible = true;
    } else if (p.phase === 'work' && g.layout.variant === 'compact') {
      // Rotations end with the work window: a departure stepping back to its
      // post leaves again instead of walking to a work post through the exits.
      const destination = now < returnAt ? this.#post(p, g, now) : p.actor.position;
      if (now >= returnAt) p.working = false;
      if (
        Math.hypot(destination.x - p.actor.position.x, destination.z - p.actor.position.z) > 0.05 &&
        now >= p.connectorRetry
      ) {
        const connector = worksiteConnector(
          p.actor.position,
          destination,
          this.hooks.project(m.target),
          (q, r) => this.#connectorFree(p, g, q, r),
          this.#connectorPosts(p, g),
        );
        if (!connector) {
          p.connectorRetry = now + 1000;
          p.working = false;
          p.actor.waitingSince ??= now;
          return;
        }
        p.phase = 'rotate';
        p.actor.path = connector;
        p.actor.distance = 0;
        p.actor.done = false;
        p.actor.startAt = now;
        p.actor.member = 0;
        p.actor.speed = 1;
        p.actor.rank = 100 + p.index;
        p.actor.local = true;
      }
    } else if (p.phase === 'work') p.working = g.layout.variant !== 'blocked';
    if (p.phase === 'work' && p.role === 'carry' && p.actor.done && p.working && g.layout.variant !== 'compact') {
      const fx = Math.sin(station.facing),
        fz = Math.cos(station.facing),
        from = { ...p.actor.position },
        target = this.hooks.project(m.target);
      const side =
        (station.x - target.x) * Math.cos(station.facing) - (station.z - target.z) * Math.sin(station.facing) < 0
          ? -1
          : 1;
      // Carry outside the processing line instead of walking through its workers.
      const lane = {
        x: station.x + Math.cos(station.facing) * side * 1.2,
        z: station.z - Math.sin(station.facing) * side * 1.2,
      };
      const back = { x: lane.x - fx * 0.8, z: lane.z - fz * 0.8 },
        forward = { x: lane.x + fx * 0.65, z: lane.z + fz * 0.65 };
      if (now >= p.connectorRetry) {
        const route: WorkerPoint[] = [from];
        for (const stop of [lane, back, forward, lane, station]) {
          const connector = worksiteConnector(
            route[route.length - 1]!,
            stop,
            target,
            (q, r) => this.#connectorFree(p, g, q, r),
            this.#connectorPosts(p, g),
          );
          if (!connector) {
            route.length = 0;
            break;
          }
          route.push(...connector.slice(1));
        }
        if (route.length) {
          p.actor.path = route;
          p.actor.distance = 0;
          p.actor.done = false;
          p.actor.visible = true;
          p.actor.member = 0;
          p.actor.startAt = now;
          p.actor.speed = 1;
          p.actor.rank = 100 + p.index;
        } else {
          p.working = false;
          p.actor.waitingSince ??= now;
          p.connectorRetry = now + 1000;
        }
      } else p.working = false;
    }
    if (
      p.phase === 'work' &&
      m.stops?.length &&
      g.stop < m.stops.length - 1 &&
      now >= Math.max(m.startedAt + m.stops[g.stop]!.workEndsAfterMs, p.arrivedAt + 600)
    ) {
      g.stop++;
      g.route = this.#route(m, g.stop);
      g.layout = this.#layout(m, g.route, g.stop);
      this.#graphDirty = true;
      const stop = m.stops[g.stop]!,
        legMs = stop.arrivesAfterMs - m.stops[g.stop - 1]!.workEndsAfterMs;
      p.phase = 'outbound';
      p.harvestProgress = 0;
      p.actor.path = [{ ...p.actor.position }, ...g.route];
      p.actor.distance = 0;
      p.actor.done = false;
      p.actor.startAt = now;
      p.actor.member = 0;
      p.actor.speed = pathLength(g.route) / Math.max(0.5, legMs / 1000);
      p.actor.direction = 1;
      p.actor.rank = 0;
      return;
    }
    // A rotation in flight ends at its post first: a body stopped beside the
    // road end would block every teammate's exit connector.
    if (p.phase === 'work' && now >= Math.max(returnAt, p.arrivedAt + 600)) {
      p.phase = 'load';
      p.phaseAt = now;
    }
    if (p.phase === 'load' && now - p.phaseAt >= 450 && now >= p.connectorRetry) {
      const back = this.#backRoute(g);
      // An extraction site empties in convoy order, one connector at a time,
      // each joining the road where it passes closest. Ten exits converging at
      // once on the road end meet within body clearance and never move again.
      if (extraction && !this.#nextLeaver(p, g, back, now)) return;
      const join = extraction ? this.#roadJoin(p.actor.position, back) : { point: back[0]!, tail: back.slice(1) };
      const connector =
        m.resource === 'garden' || m.resource === 'survey'
          ? [{ ...p.actor.position }, join.point]
          : worksiteConnector(
              p.actor.position,
              join.point,
              this.hooks.project(m.target),
              (q, r) => this.#connectorFree(p, g, q, r, EXIT_MARGIN),
              this.#connectorPosts(p, g),
            );
      if (!connector) {
        // A road join is taken for a moment by each passing teammate: try
        // again before the convoy's next gap has gone by.
        p.connectorRetry = now + (extraction ? 250 : 1000);
        p.actor.waitingSince ??= now;
        return;
      }
      const path = [...connector, ...join.tail],
        exit = extraction ? connector.length : 0;
      if (exit && !this.#spacedDeparture(p, g, path, exit, back)) {
        p.connectorRetry = now + 250;
        return;
      }
      p.phase = 'inbound';
      p.phaseAt = now;
      p.exit = exit;
      p.actor.path = path;
      p.actor.distance = 0;
      p.actor.done = false;
      // Each return starts on its own connector: no rank can pair up on it, and
      // a rear-member offset would only hide the figure for its first half metre.
      p.actor.member = p.exit ? 0 : p.index % 2;
      p.actor.formation = 0;
      p.actor.waitingSince = null;
      p.actor.startAt = p.exit ? now : now + Math.floor(p.index / 2) * 120;
      p.actor.direction = -1;
      p.actor.rank = Math.floor(p.index / 2);
      p.actor.local = p.exit > 0;
      p.actor.speed = p.exit ? 1.6 : this.#returnSpeed(g, back);
    }
    if (
      p.phase === 'inbound' &&
      p.exit &&
      p.actor.distance >= pathLength(p.actor.path.slice(0, p.exit)) + WORKER_CLEARANCE * 2
    ) {
      // On the road: walk at the convoy's pace and let the next teammate leave.
      p.exit = 0;
      p.actor.local = false;
      p.actor.speed = this.#returnSpeed(g, this.#backRoute(g));
    }
    if (p.phase === 'inbound' && p.actor.done) {
      p.phase = 'done';
      p.root.setEnabled(false);
      p.actor.visible = false;
    }
  }
  animate(now: number, enabled: boolean) {
    const start = performance.now();
    this.#animate(now, enabled);
    if (enabled) {
      this.#costs.push(performance.now() - start);
      if (this.#costs.length > 120) this.#costs.shift();
    }
  }
  #animate(now: number, enabled: boolean) {
    if (!enabled) {
      for (const g of this.#groups.values()) {
        g.root.setEnabled(false);
        for (const p of g.people) p.root.setEnabled(false);
      }
      return;
    }
    const elapsed = this.#lastNow === null ? 0 : Math.max(0, (now - this.#lastNow) / 1000);
    // Figures created behind a long loading screen were never shown: start
    // them where they are now, as after a long absence.
    const resumed =
      elapsed > 30 || (this.#lastNow === null && [...this.#groups.values()].some((g) => now - g.createdAt > 30_000));
    this.#lastNow = now;
    if (resumed) {
      this.#traffic.reset();
      for (const g of this.#groups.values()) for (const p of g.people) this.#reconstructPerson(p, g, now);
      this.#graphDirty = true;
    }
    this.#accumulator = resumed ? 0 : this.#accumulator + Math.min(elapsed, 0.133);
    if (this.#graphDirty) {
      this.#traffic.rebuild(
        [...this.#groups.values()].flatMap((g) =>
          g.mission.stops?.length
            ? [...g.mission.stops.map((_, i) => this.#route(g.mission, i)), this.#backRoute(g)]
            : (g.mission.leisure?.map((l) => l.path) ??
              (g.mission.resource === 'trade' ? [g.route] : [g.route, this.#backRoute(g)])),
        ),
      );
      this.#graphDirty = false;
    }
    // Active waits are visible waits. Only obsolete visual tails expire.
    // Each person fades independently, and an obsolete decision can be cancelled.
    for (const g of this.#groups.values())
      for (const p of g.people) {
        const obsolete =
          p.phase !== 'done' &&
          ((g.retired && now - g.mission.completesAt > WORKER_REBUILD_MS) ||
            now - g.mission.completesAt > Math.max(30_000, g.mission.transportMs * 2));
        if (!obsolete) {
          p.retireAt = null;
          continue;
        }
        p.retireAt ??= now;
        if (now - p.retireAt >= 350) {
          p.phase = 'done';
          p.actor.done = true;
          p.actor.visible = false;
          p.valid = false;
        }
      }
    let steps = 0;
    while (this.#accumulator >= WORKER_STEP && steps++ < 4) {
      const actors: TrafficActor[] = [],
        stationary: WorkerPoint[] = [];
      for (const g of this.#groups.values())
        for (const p of g.people) {
          p.previous = { ...p.actor.position };
          if (this.hooks.ground(p.actor.position) !== null) this.#transition(p, g, now);
          if (
            ['outbound', 'install', 'rotate', 'inbound'].includes(p.phase) ||
            (p.phase === 'work' &&
              p.role === 'carry' &&
              g.layout.variant !== 'blocked' &&
              g.layout.variant !== 'compact')
          )
            actors.push(p.actor);
          else if (p.phase === 'work' || p.phase === 'load') stationary.push(p.actor.position);
        }
      const tradeIds = new Set(
        [...this.#groups.values()].filter((g) => g.mission.resource === 'trade').map((g) => g.mission.id),
      );
      this.#traffic.step(
        actors.filter((a) => !tradeIds.has(a.mission)),
        now,
        WORKER_STEP,
        stationary,
        (p) => this.hooks.ground(p) !== null,
      );
      this.#accumulator -= WORKER_STEP;
    }
    for (const [key, g] of this.#groups) {
      if (g.people.every((p) => p.phase === 'done')) {
        this.#finished.add(g.mission.id);
        this.#disposeGroup(g);
        this.#groups.delete(key);
        this.#graphDirty = true;
        if (this.#latest.get(key)?.id === g.mission.id) this.#latest.delete(key);
        continue;
      }
      const working = g.people.some((p) => p.phase === 'work' || p.phase === 'load');
      g.root.setEnabled(working && g.layout.variant !== 'blocked');
      const detailed = this.hooks.detailed(g.layout.approach),
        animateLimbs = detailed || now - this.#lastAnimation > 120;
      for (const p of g.people) this.#renderPerson(p, g, now, animateLimbs);
      const span = this.#workWindow(g),
        t = (now - span.start) / 1000,
        sawing = teamActivity(g.seed, g.mission.resource, g.mission.count, 'saw', t) === 'saw';
      for (const saw of g.saws) {
        const meta = saw.metadata as { x: number; z: number; ux: number; uz: number; pair: number };
        const station = g.layout.stations.find((s) => s.role === 'saw' && s.pair === meta.pair)!;
        saw.setEnabled(sawing && g.people.some((p) => p.role === 'saw' && this.#workingAtPost(p, g)));
        const height = this.hooks.ground(station),
          stroke = sawStroke(this.#sawSeed(g, meta.pair), t) * SAW_GRIP.stroke;
        saw.isVisible = height !== null;
        for (const handle of saw.getChildMeshes()) handle.isVisible = saw.isVisible;
        saw.position.y = (height ?? 0) + SAW_BLADE.y;
        saw.position.x = meta.x + meta.ux * stroke;
        saw.position.z = meta.z + meta.uz * stroke;
      }
      for (const block of g.blocks) {
        const point = { x: block.position.x + g.root.position.x, z: block.position.z + g.root.position.z },
          height = this.hooks.ground(point);
        block.isVisible = height !== null;
        block.position.y = (height ?? 0) + 0.12;
        const index = (block.metadata as { station?: number } | null)?.station;
        if (index !== undefined && g.people[index]?.role === 'carry') {
          const p = g.people[index]!;
          block.position.x = p.actor.position.x - g.root.position.x + Math.sin(p.angle) * 0.29;
          block.position.z = p.actor.position.z - g.root.position.z + Math.cos(p.angle) * 0.29;
        }
      }
      if (g.wood) this.#renderWood(g, g.wood, now);
    }
    if (now - this.#lastAnimation > 120) this.#lastAnimation = now;
    this.#admit(now);
  }
  #renderWood(g: Group, w: WoodProps, now: number) {
    const span = this.#workWindow(g),
      duration = (span.end - span.start) / 1000,
      t = (now - span.start) / 1000,
      seenFrom = (g.createdAt - span.start) / 1000;
    const feller = g.people[w.feller];
    if (w.fellerAt === null && feller && this.#workingAtPost(feller, g)) w.fellerAt = t;
    // A fall already due when the site was first shown is never waited for (F5).
    const planned = woodPlannedFall(duration),
      // A trunk already lying is cut up from the start, with no fall.
      fallAt = w.tree && w.tree.lying > 0 ? -10 : seenFrom >= planned ? planned : woodFallAt(duration, w.fellerAt);
    const site = woodSite(duration, t, fallAt, seenFrom);
    const groundAt = (q: WorkerPoint) => this.hooks.ground({ x: q.x + g.root.position.x, z: q.z + g.root.position.z });
    if (w.heading && w.tilt && w.trunk && w.crown && w.tree) {
      const base = groundAt(w.base);
      w.heading.setEnabled(base !== null && site.sections > 0);
      // Once down, the trunk rests on its side, without its foliage (kit README).
      const landed = site.tilt >= Math.PI / 2 - 1e-6;
      w.heading.position.y = (base ?? 0) + (landed ? KIT_TRUNK_RADIUS * w.tree.scale : 0);
      // A strike shakes the standing tree, damped in 0.4 s.
      let shake = 0;
      if (site.tilt === 0 && feller && this.#workingAtPost(feller, g)) {
        const age =
          feller.role === 'axe'
            ? (feller.plans.get('hache')?.impactAge(t) ?? Infinity)
            : feller.role === 'saw'
              ? (t * 1000) % 1100 < 1100 / 2
                ? Infinity
                : ((t * 1000) % 550) / 1000
              : Infinity;
        if (age < 0.4) shake = TREE_SHAKE * Math.sin(age * 45) * (1 - age / 0.4);
      }
      w.tilt.rotation.x = site.tilt + shake;
      // The lot cuts reserved / share of a trunk: what is left lies in the grove after it.
      const from = w.tree.lying > 0 ? w.tree.lying : 1,
        to = Math.max(0, from - (w.tree.share > 0 ? (g.mission.reserved ?? w.tree.share) / w.tree.share : 1)),
        length = to + (from - to) * (site.sections / WOOD_SECTIONS);
      w.heading.setEnabled(base !== null && length > 0.001);
      w.trunk.scaling.y = Math.max(0.001, length);
      if (w.plan?.pair0.length === 2 && landed) this.#followCut(g, w.plan, to, from, site.sections);
      w.crown.setEnabled(!landed && site.sections === WOOD_SECTIONS);
    }
    // The pile leaves with the carriers once loading starts.
    const pile = groundAt(w.pile),
      loaded = now >= span.end + 450;
    for (const [i, log] of w.logs.entries()) {
      log.setEnabled(pile !== null && !loaded && i < site.logs);
      const level = (log.metadata as { level: number }).level;
      log.position.y = (pile ?? 0) + PILE_LOG.diameter / 2 + level * PILE_LOG.diameter * 0.9;
    }
  }
  /**
   * Saw pair 0 cuts the lying trunk from its end towards its foot: at each
   * section it steps to the next cut, and its saw follows.
   */
  #followCut(g: Group, plan: WoodPlan, to: number, from: number, sections: number) {
    const cut = plan.length * (to + ((from - to) * Math.max(0, sections - 1)) / WOOD_SECTIONS),
      centre = { x: plan.base.x + plan.fall.x * cut, z: plan.base.z + plan.fall.z * cut };
    for (const [side, index] of plan.pair0.entries()) {
      const station = g.layout.stations[index]!,
        sign = side === 0 ? 1 : -1,
        post = { x: centre.x + plan.across.x * 0.49 * sign, z: centre.z + plan.across.z * 0.49 * sign },
        previous = station.workAt ?? station;
      if (Math.hypot(post.x - previous.x, post.z - previous.z) < 0.01) continue;
      const person = g.people[index],
        settled = person ? this.#workingAtPost(person, g) : false;
      station.x = post.x;
      station.z = post.z;
      station.workAt = post;
      station.facing = Math.atan2(centre.x - post.x, centre.z - post.z);
      // One step to the next cut, keeping its work.
      if (person && settled) {
        person.actor.position = { ...post };
        person.last = { ...post };
        person.previous = { ...post };
      }
    }
    const saw = g.saws.find((m) => (m.metadata as { pair: number }).pair === 0);
    if (saw) {
      const meta = saw.metadata as { x: number; z: number; ux: number; uz: number };
      meta.x = centre.x;
      meta.z = centre.z;
      meta.ux = plan.across.x;
      meta.uz = plan.across.z;
      saw.rotation.y = -Math.atan2(plan.across.z, plan.across.x);
    }
  }
  #workingAtPost(p: Person, g: Group) {
    const station = g.layout.stations[p.index]!,
      at = station.workAt;
    return (
      p.phase === 'work' &&
      p.working &&
      g.layout.variant !== 'blocked' &&
      (!at || Math.hypot(p.actor.position.x - at.x, p.actor.position.z - at.z) < 0.1)
    );
  }
  #renderPerson(p: Person, g: Group, now: number, animateLimbs: boolean) {
    if (p.phase === 'done' || p.phase === 'inside') {
      p.visible = false;
      p.root.setEnabled(false);
      return;
    }
    const gardening = p.phase === 'work' && g.mission.resource === 'garden';
    const travelling =
      gardening ||
      ['outbound', 'install', 'rotate', 'inbound'].includes(p.phase) ||
      (p.phase === 'work' && p.role === 'carry' && !p.actor.done);
    const alpha = travelling ? Math.min(1, this.#accumulator / WORKER_STEP) : 1;
    const point = {
        x: p.previous.x + (p.actor.position.x - p.previous.x) * alpha,
        z: p.previous.z + (p.actor.position.z - p.previous.z) * alpha,
      },
      height = this.hooks.ground(point);
    p.visible = p.actor.visible && height !== null;
    p.root.setEnabled(p.visible);
    if (!p.visible) return;
    const dx = point.x - p.last.x,
      dz = point.z - p.last.z,
      movement = Math.hypot(dx, dz);
    const moving = travelling && movement > 0.00001;
    if (movement > 0.00001) p.angle = Math.atan2(dx, dz);
    else if (!moving && (p.phase === 'work' || p.phase === 'load')) p.angle = g.layout.stations[p.index]!.facing;
    const heading = p.angle + p.pose.yaw,
      angleDelta = Math.atan2(Math.sin(heading - p.root.rotation.y), Math.cos(heading - p.root.rotation.y));
    p.root.rotation.y += angleDelta * 0.22;
    p.root.position.set(point.x, (height ?? 0) + 0.215, point.z);
    p.walk += movement * 6.3;
    p.last = { ...point };
    p.fade = Math.min(1, p.fade + 0.08);
    const opacity = p.retireAt !== null ? Math.max(0, 1 - (now - p.retireAt) / 350) : p.fade;
    for (const mesh of p.meshes) mesh.visibility = opacity;
    const working = this.#workingAtPost(p, g),
      span = this.#workWindow(g),
      t = (now - span.start) / 1000,
      duration = (span.end - span.start) / 1000;
    const role = working ? teamActivity(g.seed, g.mission.resource, g.mission.count, p.role, t) : p.role;
    const loaded =
      g.mission.resource === 'trade' ||
      ((p.phase === 'load' || p.phase === 'inbound') && p.worked) ||
      (g.stop > 0 && g.mission.resource === 'garden' && !gardening) ||
      (working && role === 'carry' && (p.role !== 'carry' || p.actor.distance > 1.25));
    p.cargo.setEnabled(loaded && g.mission.resource !== 'survey' && g.mission.resource !== 'leveling');
    this.#showTool(p, working && isGestureRole(role) ? ROLE_TOOL[role] : null);
    p.basket?.setEnabled(gardening);
    const pose = scratchPose;
    let carrot = false,
      motion: string;
    if (gardening && !moving) {
      carrot = gardenPose(p.seed, t, duration, pose);
      motion = 'garden';
    } else if (working && role === 'saw') {
      const pair = g.layout.variant === 'compact' ? 0 : g.layout.stations[p.index]!.pair;
      sawPose(sawStroke(this.#sawSeed(g, pair), t), this.#sawPartner(g, p, pair), pose);
      motion = 'saw';
    } else if (working && role === 'carry' && !moving) {
      carryPose(pose);
      motion = 'carry';
    } else if (working && isGestureRole(role)) {
      const gesture = ROLE_GESTURE[role];
      let plan = p.plans.get(gesture);
      if (!plan) p.plans.set(gesture, (plan = new StrikePlan(p.seed, gesture)));
      plan.pose(t, duration, pose);
      motion = gesture;
    } else {
      walkPose(moving ? p.walk : 0, loaded, pose);
      motion = moving ? 'walk' : loaded ? 'loaded' : 'stand';
    }
    p.carrot?.setEnabled(carrot);
    if (!animateLimbs) return;
    // A change of activity blends from the pose shown.
    if (motion !== p.motion) {
      if (p.motion) copyPose(p.pose, p.blendFrom);
      else copyPose(pose, p.blendFrom);
      p.blendAt = now;
      p.motion = motion;
    }
    const blend = (now - p.blendAt) / (GESTURE_BLEND_S * 1000);
    if (blend < 1) mixPose(p.blendFrom, pose, ease(blend), p.pose);
    else copyPose(pose, p.pose);
    const [left, right, legL, legR] = p.limbs;
    left!.rotation.set(p.pose.bL, 0, 0);
    right!.rotation.set(p.pose.bR, 0, 0);
    legL!.rotation.x = p.pose.jL;
    legR!.rotation.x = p.pose.jR;
    p.waist.rotation.x = p.pose.buste;
  }
  /** Server work window: the gestures' clock, the same for every player and after F5. */
  #workWindow(g: Group) {
    const m = g.mission,
      stop = m.stops?.[g.stop];
    return stop
      ? { start: m.startedAt + stop.arrivesAfterMs, end: m.startedAt + stop.workEndsAfterMs }
      : { start: m.startedAt + m.transportMs, end: m.completesAt - m.transportMs };
  }
  #sawSeed(g: Group, pair: number) {
    let seed = g.sawSeeds.get(pair);
    if (seed === undefined) g.sawSeeds.set(pair, (seed = gestureSeed(g.mission.key, 100 + pair)));
    return seed;
  }
  /** The second sawyer of a pair pulls while the first pushes. */
  #sawPartner(g: Group, p: Person, pair: number) {
    return (
      g.layout.stations.findIndex((s) => s.role === 'saw' && (g.layout.variant === 'compact' || s.pair === pair)) !==
      p.index
    );
  }
  #showTool(p: Person, tool: VillagerTool | null) {
    if (tool && !p.tools.has(tool)) {
      const node = new TransformNode(`${p.root.name}-tool`, this.scene);
      node.parent = p.limbs[1]!;
      const mesh = this.#piece(`${p.root.name}-outil-${tool}`, `outil-${tool}`, this.materials.white, node);
      mesh.visibility = p.meshes[0]!.visibility;
      p.meshes.push(mesh);
      p.tools.set(tool, node);
    }
    for (const [name, node] of p.tools) node.setEnabled(name === tool);
  }
  selectRepresentative(id: string | null) {
    this.#selectedRepresentative = id !== null && this.representativeInfo(id) ? id : null;
  }
  get selectedRepresentative() {
    if (this.#selectedRepresentative && !this.representativeInfo(this.#selectedRepresentative))
      this.#selectedRepresentative = null;
    return this.#selectedRepresentative;
  }
  hideRepresentative(id: string | null) {
    this.#hiddenRepresentative = id;
  }
  representativePose(id: string) {
    for (const g of this.#groups.values())
      for (const p of g.people)
        if (p.meshes[0]?.metadata?.representativeId === id && p.valid && p.phase !== 'done')
          return {
            position: p.root.isEnabled()
              ? p.root.position.clone()
              : new Vector3(
                  p.actor.position.x,
                  this.hooks.ground(p.actor.position) ?? p.root.position.y - 0.215,
                  p.actor.position.z,
                ).add(new Vector3(0, 0.215, 0)),
            heading: p.root.rotation.y,
            presence: this.#presence(p),
          };
    return null;
  }
  representativeInfo(id: string): RepresentativeInfo | null {
    for (const g of this.#groups.values())
      for (const p of g.people) {
        if (p.meshes[0]?.metadata?.representativeId !== id || !p.valid || p.phase === 'done') continue;
        const m = g.mission,
          cohorts = this.#snapshot?.village.population?.cohorts ?? [];
        const cohort = cohorts.find((c) => c.id === p.cohortId);
        let hash = 2166136261;
        for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
        const names = [
          'Alix',
          'Camille',
          'Lou',
          'Sacha',
          'Élie',
          'Noa',
          'Charlie',
          'Jules',
          'Morgan',
          'Robin',
          'Léonie',
          'Malo',
          'Ari',
          'Adèle',
          'Nour',
          'Maël',
        ];
        const target = m.stops?.[g.stop] ?? m.target;
        const home = m.leisure?.[g.stop]?.to;
        const building = this.#snapshot?.cells.find((c) => c.building?.id === home)?.building;
        const destination =
          p.phase === 'inbound'
            ? 'Hôtel de ville'
            : m.resource === 'idle'
              ? building?.type === 'town-hall'
                ? 'Hôtel de ville'
                : 'Maison'
              : `${m.resource === 'garden' ? 'Jardin' : m.resource === 'wood' ? 'Bosquet' : m.resource === 'stone' ? 'Gisement de pierre' : 'Relevé'} · ${target.cellX}, ${target.cellY}`;
        return {
          id,
          cohortId: p.cohortId,
          presence: this.#presence(p),
          waiting: p.actor.waitingSince !== null,
          name: names[hash % names.length]!,
          cohortSize: cohort?.memberCount ?? null,
          energy: cohort?.energy ?? null,
          qualifications: cohort
            ? [cohort.cartographer ? 'Cartographe' : 'Aucune qualification spécialisée']
            : ['Non renseignées'],
          destination,
          mode:
            m.resource === 'idle'
              ? 'Balade'
              : m.resource === 'wood' || m.resource === 'stone' || m.resource === 'leveling'
                ? 'Chantier'
                : m.resource === 'garden'
                  ? 'Mission de récolte'
                  : 'Mission de reconnaissance',
        };
      }
    return null;
  }
  populationPosition(id: string) {
    for (const group of this.#groups.values())
      for (const person of group.people) {
        const body = person.meshes[0];
        if (person.valid && person.root.isEnabled() && body?.metadata?.populationId === id && body.visibility > 0.05)
          return body.getAbsolutePosition();
      }
    return null;
  }
  setPopulationFocus(enabled: boolean, focus: string | null, filter: string) {
    this.#populationMode = enabled;
    this.#populationFocus = focus;
    this.#populationFilter = filter;
  }
  setVisibility(blend: number) {
    for (const g of this.#groups.values()) {
      for (const mesh of g.root.getChildMeshes()) mesh.visibility = blend;
      for (const p of g.people) {
        const body = p.meshes[0]!,
          meta = body.metadata;
        const matches =
          (!this.#populationFocus || meta.populationId === this.#populationFocus) &&
          (this.#populationFilter === 'all' || this.#populationFilter === 'training'
            ? this.#populationFilter === 'all' || meta.populationKind === 'science'
            : meta.populationActivity === this.#populationFilter);
        for (const mesh of p.meshes) mesh.visibility *= blend * (this.#populationMode && !matches ? 0.25 : 1);
        if (body.metadata.representativeId === this.#hiddenRepresentative)
          for (const mesh of p.meshes) mesh.visibility = 0;
        body.isPickable = this.#populationMode && body.metadata.representativeId !== this.#hiddenRepresentative;
        const outlined = this.#populationMode && matches;
        if (outlined && !meta.populationOutlined) {
          body.enableEdgesRendering();
          body.edgesColor.set(0.8, 1, 0.85, 1);
          body.edgesWidth = 2;
        } else if (!outlined && meta.populationOutlined) body.disableEdgesRendering();
        meta.populationOutlined = outlined;
      }
    }
  }
  #disposeGroup(g: Group) {
    if (g.wood?.tree) this.hooks.releaseTree?.(g.mission.id);
    for (const p of g.people) p.dispose();
    g.root.dispose(false, false);
  }
  dispose() {
    for (const g of this.#groups.values()) this.#disposeGroup(g);
    this.#boxSource?.dispose(false, false);
    this.#boxSource = null;
    for (const source of this.#pieceSources.values()) source.dispose(false, false);
    this.#pieceSources.clear();
    this.#groups.clear();
    this.#latest.clear();
    this.#pending.clear();
    this.#finished.clear();
    this.#traffic.reset();
  }
}
