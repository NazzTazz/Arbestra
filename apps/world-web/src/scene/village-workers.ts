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
  type TrafficActor,
  type WorkerPoint,
  type WorkerRole,
} from './worker-motion';
import { worksiteLayout, worksiteConnector, type WorksiteLayout } from './worksite-layout';
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
export interface WorkerHooks {
  path: (path: TravelCell[]) => Vector3[];
  project: (point: TravelCell) => WorkerPoint;
  ground: (point: WorkerPoint) => number | null;
  free: (point: WorkerPoint, radius: number, featureId: string | null, allowRoads?: boolean) => boolean;
  key: (point: WorkerPoint) => string;
  detailed: (point: WorkerPoint) => boolean;
  width?: (point: WorkerPoint) => number;
  localPath?: (path: TravelCell[]) => Vector3[];
  leisurePath?: (buildingId: string, path: TravelCell[]) => Vector3[];
  /** Changes when projected positions or ground heights used by leisurePath change. */
  leisureVersion?: () => string;
}
interface Mission {
  id: string;
  key: string;
  resource: 'wood' | 'stone' | 'garden' | 'idle' | 'survey' | 'trade' | 'leveling';
  count: number;
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
  retired: boolean;
  createdAt: number;
  stop: number;
}

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
/** Two-man saw blade: centre height above the ground, its lower edge on the trunk's top (0.375 m). */
const SAW_BLADE = { y: 0.4, height: 0.055 };

/** All positions and short visual tails live here; no economic writes or timers. */
export class VillageWorkers {
  readonly #groups = new Map<string, Group>();
  readonly #latest = new Map<string, Mission>();
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
  get metrics() {
    return {
      figures: this.figures.length,
      idleRepresentatives: [...this.#groups.values()].filter((g) => g.mission.resource === 'idle').length,
      blocked: this.#traffic.blocked,
      pending: this.#pending.size,
      updateMs: this.#costs.length ? this.#costs.reduce((a, b) => a + b, 0) / this.#costs.length : 0,
      maxUpdateMs: Math.max(0, ...this.#costs),
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
        const points = path ? this.hooks.leisurePath!(c.building!.id, path) : [];
        const visit = points.length
          ? {
              buildingId: c.building!.id,
              path: points.map((v, i) =>
                this.#point(v, i === 0 || i === points.length - 1 ? 0.5 : (this.hooks.width?.(v) ?? 0.8)),
              ),
            }
          : null;
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
    return { x: p.x, z: p.z, width, key: this.hooks.key(p) };
  }
  #route(m: Mission, stop = 0) {
    if (m.leisure) return m.leisure[stop]!.path.map((p) => this.#point(p, p.width));
    const path = m.stops?.[stop]?.path ?? m.path;
    const vectors =
      stop > 0 || m.resource === 'trade' ? (this.hooks.localPath ?? this.hooks.path)(path) : this.hooks.path(path);
    const passage =
      m.resource === 'wood' || m.resource === 'stone' || m.resource === 'leveling'
        ? workerPassagePath(vectors)
        : vectors;
    const p = passage.map((v, i) => this.#point(v, stop === 0 && i < 2 ? 0.5 : (this.hooks.width?.(v) ?? 0.8)));
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
    p.actor.member = p.index % 2;
    p.actor.formation = 0;
    p.actor.lateral = 0;
    p.visible = false;
    p.fade = 0;
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
          p.actor.position = { ...this.#post(p, g, now) };
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
      p.actor.path = [...g.route].reverse();
      p.actor.distance = Math.max(
        0,
        Math.min(pathLength(g.route), (p.actor.speed * (now - backStart)) / 1000 - Math.floor(p.index / 2) * 0.52),
      );
      p.actor.startAt = now;
    } else if (now >= outEnd) {
      p.phase = 'work';
      p.phaseAt = now;
      p.arrivedAt = outEnd;
      p.actor.position = { ...this.#post(p, g, now) };
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
  #backRoute(g: Group): WorkerPoint[] {
    if (g.mission.returnPath?.length)
      return this.hooks
        .path([...g.mission.returnPath].reverse())
        .reverse()
        .map((v) => this.#point(v));
    return [...g.route].reverse();
  }
  #post(p: Person, g: Group, now: number): WorkerPoint {
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
      turn = Math.floor(elapsed / 12_000);
    p.working = elapsed % 12_000 >= 2_000 && peers[turn % Math.max(1, peers.length)]?.index === p.index;
    return p.working ? station.workAt : station;
  }
  #props(g: Group) {
    const m = g.mission;
    if (m.resource === 'garden' || m.resource === 'idle' || m.resource === 'survey' || m.resource === 'trade') return;
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
    g.root.setEnabled(false);
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
        g.saws = [];
        g.blocks = [];
        g.root.position.setAll(0);
        this.#props(g);
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
  #connectorFree(p: Person, g: Group, point: WorkerPoint, radius: number) {
    return (
      this.#reservedPosts(p, g).every((s) => Math.hypot(point.x - s.x, point.z - s.z) >= radius + 0.24) &&
      g.people.every(
        (other) =>
          other === p ||
          !other.actor.visible ||
          Math.hypot(point.x - other.actor.position.x, point.z - other.actor.position.z) >= WORKER_CLEARANCE,
      ) &&
      this.hooks.free(point, radius, g.mission.featureId, true)
    );
  }
  #connectorPosts(p: Person, g: Group) {
    const neighbours = g.people.filter((other) => other !== p && other.actor.visible);
    return [...this.#reservedPosts(p, g), ...neighbours.map((other) => other.actor.position)];
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
    if (g.layout.variant === 'compact' && p.phase === 'outbound' && !p.actor.visible) {
      // A compact site cannot accept the whole road formation at once. Admit
      // one arrival at a time, filling each distinct work post before its queue.
      const first = new Set<string>(),
        order: Person[] = [],
        queue: Person[] = [];
      for (const person of g.people) {
        const slot = g.layout.stations[person.index]!.slot!;
        if (first.has(slot)) queue.push(person);
        else {
          first.add(slot);
          order.push(person);
        }
      }
      order.push(...queue);
      if (
        order.slice(0, order.indexOf(p)).some((person) => person.phase === 'outbound' || person.phase === 'install')
      ) {
        p.actor.startAt = now + WORKER_STEP * 1000;
        return;
      }
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
        const door = g.route[0]!;
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
    const roadArrival =
      p.actor.done ||
      (['wood', 'stone', 'leveling'].includes(m.resource) &&
        p.actor.visible &&
        pathLength(p.actor.path) -
          p.actor.distance +
          (p.actor.member ?? 0) * 0.5 * Math.cos(((p.actor.formation ?? 0) * Math.PI) / 2) <=
          this.#installationDistance(g));
    if (p.phase === 'outbound' && roadArrival && now >= p.connectorRetry) {
      const from = { ...p.actor.position },
        target = this.hooks.project(m.target);
      const destination = g.layout.variant === 'compact' ? this.#post(p, g, now) : station;
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
      if (!connector) {
        p.connectorRetry = now + 1000;
        p.actor.waitingSince ??= now;
        return;
      }
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
      p.actor.speed = 1.6;
    } else if ((p.phase === 'install' || p.phase === 'rotate') && p.actor.done) {
      p.phase = 'work';
      p.phaseAt = now;
    }
    if (
      (p.phase === 'install' || p.phase === 'rotate') &&
      ['wood', 'stone', 'leveling'].includes(m.resource) &&
      p.actor.waitingSince !== null &&
      now - p.actor.waitingSince >= 1500 &&
      now >= p.connectorRetry
    ) {
      p.connectorRetry = now + 1500;
      const goal = p.actor.path.at(-1)!,
        connector = worksiteConnector(
          p.actor.position,
          goal,
          this.hooks.project(m.target),
          (q, r) => this.#connectorFree(p, g, q, r),
          this.#connectorPosts(p, g),
        );
      if (connector) {
        p.actor.path = connector;
        p.actor.distance = 0;
        p.actor.member = 0;
        p.actor.formation = 0;
        p.actor.lateral = 0;
        p.actor.startAt = now;
        this.#graphDirty = true;
      }
    }
    if (p.phase === 'work' && m.resource === 'garden') {
      const stop = m.stops?.[g.stop],
        duration = stop ? stop.workEndsAfterMs - stop.arrivesAfterMs : m.completesAt - m.startedAt - m.transportMs * 2;
      p.harvestProgress = Math.min(1, (p.harvestProgress ?? 0) + (WORKER_STEP * 1000) / Math.max(1, duration));
      p.actor.position = this.#post(p, g, now);
      p.actor.visible = true;
    } else if (p.phase === 'work' && g.layout.variant === 'compact') {
      const destination = this.#post(p, g, now);
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
    const returnAt = m.stops?.length
      ? m.startedAt + m.stops[m.stops.length - 1]!.workEndsAfterMs
      : m.completesAt - m.transportMs;
    if ((p.phase === 'work' || p.phase === 'rotate') && now >= Math.max(returnAt, p.arrivedAt + 600)) {
      p.phase = 'load';
      p.phaseAt = now;
    }
    if (p.phase === 'load' && now - p.phaseAt >= 450 && now >= p.connectorRetry) {
      const back = this.#backRoute(g),
        connector =
          m.resource === 'garden' || m.resource === 'survey'
            ? [{ ...p.actor.position }, back[0]!]
            : worksiteConnector(
                p.actor.position,
                back[0]!,
                this.hooks.project(m.target),
                (q, r) => this.#connectorFree(p, g, q, r),
                this.#connectorPosts(p, g),
              );
      if (!connector) {
        p.connectorRetry = now + 1000;
        p.actor.waitingSince ??= now;
        return;
      }
      p.phase = 'inbound';
      p.phaseAt = now;
      p.actor.path = [...connector, ...back.slice(1)];
      p.actor.distance = 0;
      p.actor.done = false;
      p.actor.member = p.index % 2;
      p.actor.formation = 0;
      p.actor.startAt = now + Math.floor(p.index / 2) * 120;
      p.actor.direction = -1;
      p.actor.rank = Math.floor(p.index / 2);
      p.actor.speed = Math.max(
        0.8,
        pathLength(back) / Math.max(0.5, (m.stops?.length ? m.completesAt - returnAt : m.transportMs) / 1000),
      );
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
            : (g.mission.leisure?.map((l) => l.path) ?? [g.route]),
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
    }
    if (now - this.#lastAnimation > 120) this.#lastAnimation = now;
    this.#admit(now);
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
      p.phase === 'load' ||
      p.phase === 'inbound' ||
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
