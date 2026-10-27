export interface WorkerPoint {
  x: number;
  z: number;
  width?: number;
  key?: string;
}
export type WorkerRole = 'axe' | 'saw' | 'wood-chop' | 'pick' | 'break' | 'carry' | 'garden' | 'walk';
export const WORKER_RADIUS = 0.18;
export const WORKER_GAP = 0.08;
export const WORKER_CLEARANCE = WORKER_RADIUS * 2 + WORKER_GAP;
export const WORKER_STEP = 1 / 30;
export const WORKER_REBUILD_MS = 8_000;

export function workerAppearance(key: string, index: number) {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  // 7 is coprime with 45: one team never repeats a combination.
  const combination = (((seed >>> 0) % 45) + index * 7) % 45;
  return { skin: combination % 3, clothes: Math.floor(combination / 3) % 5, hair: Math.floor(combination / 15) };
}

export function workerRoles(resource: 'wood' | 'stone' | 'garden', count: number): WorkerRole[] {
  if (resource === 'garden') return Array.from({ length: count }, () => 'garden');
  if (resource === 'wood') {
    if (count === 1) return ['axe'];
    const saws = [0, 0, 2, 2, 2, 4, 4, 4, 6, 6, 6][Math.min(10, count)]!;
    return Array.from({ length: count }, (_, i) => (i < saws ? 'saw' : 'wood-chop'));
  }
  const distribution: readonly (readonly [number, number])[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [1, 1],
    [2, 1],
    [2, 2],
    [3, 2],
    [3, 2],
    [4, 2],
    [4, 3],
    [5, 3],
  ];
  const [picks, breaks] = distribution[Math.min(10, count)]!;
  return Array.from({ length: count }, (_, i) => (i < picks ? 'pick' : i < picks + breaks ? 'break' : 'carry'));
}

export function pathLength(path: readonly WorkerPoint[]) {
  let length = 0;
  for (let i = 1; i < path.length; i++) length += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
  return length;
}

/** Access searches can revisit a waypoint before continuing to the worksite.
 * Remove those closed detours for presentation: a following pair cannot pass
 * its leader on a narrow out-and-back spur. Every retained leg already exists
 * in the committed path. Work/economic paths and deadlines remain untouched. */
export function workerPassagePath<T extends WorkerPoint>(path: readonly T[]): T[] {
  const result: T[] = [],
    indices = new Map<string, number>();
  for (const point of path) {
    // A fine connector may retrace part of its final segment when it joins the
    // coarse grid. Remove only that collinear spur: the retained segment is
    // entirely contained in the committed passage, without cutting a corner.
    while (result.length >= 2) {
      const a = result[result.length - 2]!,
        b = result[result.length - 1]!;
      const dx = b.x - a.x,
        dz = b.z - a.z,
        ex = point.x - b.x,
        ez = point.z - b.z;
      if (Math.abs(dx * ez - dz * ex) > 1e-9 || dx * ex + dz * ez >= 0) break;
      result.pop();
      indices.delete(`${b.x}:${b.z}`);
    }
    const key = `${point.x}:${point.z}`,
      prior = indices.get(key);
    if (prior !== undefined) {
      while (result.length > prior + 1) {
        const removed = result.pop()!;
        indices.delete(`${removed.x}:${removed.z}`);
      }
    } else {
      indices.set(key, result.length);
      result.push(point);
    }
  }
  return result;
}

// Three crop rows along X, joined by rounded headland turns. Entry and exit
// stay at the plot centre so the road/plot connectors remain continuous.
const gardenSweep: WorkerPoint[] = [
  { x: 0, z: 0 },
  { x: -0.7, z: -0.64 },
  { x: 0.7, z: -0.64 },
];
for (let i = 1; i <= 12; i++) {
  const a = -Math.PI / 2 + (i * Math.PI) / 12;
  gardenSweep.push({ x: 0.7 + Math.cos(a) * 0.32, z: -0.32 + Math.sin(a) * 0.32 });
}
gardenSweep.push({ x: -0.7, z: 0 });
for (let i = 1; i <= 12; i++) {
  const a = -Math.PI / 2 - (i * Math.PI) / 12;
  gardenSweep.push({ x: -0.7 + Math.cos(a) * 0.32, z: 0.32 + Math.sin(a) * 0.32 });
}
gardenSweep.push({ x: 0.7, z: 0.64 }, { x: 0, z: 0 });
const gardenSweepLength = pathLength(gardenSweep);
/** Pure visual progress on one plot; server work and credit times are unchanged. */
export function gardenHarvestPoint(centre: WorkerPoint, progress: number): WorkerPoint {
  const p = sampleWorkerPath(gardenSweep, Math.max(0, Math.min(1, progress)) * gardenSweepLength);
  return { x: centre.x + p.x, z: centre.z + p.z };
}

function cycleKey(path: readonly WorkerPoint[]): string | null {
  if (path.length < 4) return null;
  const key = (p: WorkerPoint) => p.key ?? `${p.x.toFixed(3)}:${p.z.toFixed(3)}`;
  if (key(path[0]!) !== key(path[path.length - 1]!)) return null;
  const keys = path.slice(0, -1).map(key),
    first = keys.indexOf([...keys].sort()[0]!);
  return [...keys.slice(first), ...keys.slice(0, first)].join('>');
}

export function sampleWorkerPath(path: readonly WorkerPoint[], distance: number, lateral = 0) {
  if (path.length < 2) return { ...(path[0] ?? { x: 0, z: 0 }), dx: 0, dz: 1, corner: 0, taper: 1 };
  let remaining = Math.max(0, distance);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!,
      b = path[i]!,
      length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.001) continue;
    if (remaining <= length || i === path.length - 1) {
      const t = Math.min(1, remaining / length),
        dx = (b.x - a.x) / length,
        dz = (b.z - a.z) / length;
      const width = Math.min(a.width ?? 0.8, b.width ?? 0.8);
      const edge = Math.min(t * length, (1 - t) * length);
      // Straight joins keep lanes; turns and doors narrow smoothly.
      const turnAt = (n: number) => {
        if (n === 0 || n === path.length - 1) return true;
        const p = path[n - 1]!,
          q = path[n]!,
          r = path[n + 1]!;
        return (
          Math.min(p.width ?? 0.8, q.width ?? 0.8, r.width ?? 0.8) < 0.8 ||
          Math.abs((q.x - p.x) * (r.z - q.z) - (q.z - p.z) * (r.x - q.x)) > 0.01
        );
      };
      const taper = Math.min(1, Math.min(turnAt(i - 1) ? t * length : 1, turnAt(i) ? (1 - t) * length : 1) / 0.7);
      const offset = Math.max(-width / 2 + WORKER_RADIUS, Math.min(width / 2 - WORKER_RADIUS, lateral)) * taper;
      return {
        x: a.x + (b.x - a.x) * t + dz * offset,
        z: a.z + (b.z - a.z) * t - dx * offset,
        dx,
        dz,
        width,
        corner: edge,
        taper,
      };
    }
    remaining -= length;
  }
  return { ...path[path.length - 1]!, dx: 0, dz: 1, corner: 0, taper: 1 };
}

/** Minimum distance between synchronously moving discs, including between frames. */
export function sweptWorkerDistance(a: WorkerPoint, b: WorkerPoint, nextA: WorkerPoint, nextB: WorkerPoint) {
  const x = a.x - b.x,
    z = a.z - b.z,
    dx = nextA.x - a.x - (nextB.x - b.x),
    dz = nextA.z - a.z - (nextB.z - b.z);
  const d = dx * dx + dz * dz,
    t = d > 1e-12 ? Math.max(0, Math.min(1, -(x * dx + z * dz) / d)) : 0;
  return Math.hypot(x + dx * t, z + dz * t);
}

export interface TrafficActor {
  id: string;
  mission: string;
  rank: number;
  direction: 1 | -1;
  path: WorkerPoint[];
  distance: number;
  speed: number;
  position: WorkerPoint;
  visible: boolean;
  waitingSince: number | null;
  startAt: number;
  done: boolean;
  member?: number;
  formation?: number;
  lateral?: number;
  /** On a short connector around its worksite: shares the road's passages with its team, never a flow. */
  local?: boolean;
}
interface Passage {
  id: string;
  points: WorkerPoint[];
  owners: Set<string>;
  lastDirection: number;
  lastMission: string;
  /** Missions served in a row in `lastDirection`: a team's convoy is one turn. */
  served: number;
}
interface Chain {
  passages: Passage[];
  samples: Array<{ x: number; z: number; dx: number; dz: number }>;
}
/** An actor requests a passage from this distance of one of its points... */
const PASSAGE_REQUEST = 1.15;
/** ...and keeps it until it is beyond this distance of all of them. */
const PASSAGE_RETAIN = 1.3;
/** Lateral lane offset: the chain is walked along the centreline. */
const PASSAGE_LANE = 0.25;
/** Centrelines closer than this are one road; further apart, bodies pass each other. */
const PASSAGE_SAME_ROAD = 0.6;

/** Local right-of-way only. This class never knows resources or server credits. */
export class WorkerTraffic {
  readonly passages = new Map<string, Passage>();
  blocked = 0;
  #waitOrder = new Map<string, number>();
  /** Chains by path, passage and arc: a waiting actor asks the same one every step. */
  #chains = new WeakMap<readonly WorkerPoint[], Map<string, Chain>>();
  rebuild(paths: readonly WorkerPoint[][]) {
    const nodes = new Map<string, { point: WorkerPoint; links: Set<string>; turn: boolean }>();
    for (const path of paths)
      for (let i = 0; i < path.length; i++) {
        const p = path[i]!,
          key = p.key ?? `${p.x.toFixed(3)}:${p.z.toFixed(3)}`;
        const node = nodes.get(key) ?? { point: p, links: new Set<string>(), turn: i === 0 || i === path.length - 1 };
        for (const n of [path[i - 1], path[i + 1]])
          if (n) node.links.add(n.key ?? `${n.x.toFixed(3)}:${n.z.toFixed(3)}`);
        if (i > 0 && i < path.length - 1) {
          const a = path[i - 1]!,
            b = path[i + 1]!;
          node.turn ||= Math.abs((p.x - a.x) * (b.z - p.z) - (p.z - a.z) * (b.x - p.x)) > 0.01;
        }
        nodes.set(key, node);
      }
    const conflicts = [...nodes.entries()].filter(
      ([, n]) => n.turn || n.links.size > 2 || (n.point.width ?? 0.8) < 0.8,
    );
    // A narrow segment is one exclusive passage, not two unrelated end gates.
    for (const path of paths)
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!,
          b = path[i]!;
        if (Math.min(a.width ?? 0.8, b.width ?? 0.8) >= 0.8) continue;
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.6),
          edge = [a.key ?? `${a.x}:${a.z}`, b.key ?? `${b.x}:${b.z}`].sort().join('~');
        for (let n = 1; n < steps; n++) {
          const t = n / steps,
            point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, width: 0.5 };
          const forward = (a.key ?? `${a.x}:${a.z}`) < (b.key ?? `${b.x}:${b.z}`);
          conflicts.push([`${edge}:${forward ? n : steps - n}/${steps}`, { point, links: new Set(), turn: true }]);
        }
      }
    const clusters: Array<{ keys: string[]; points: WorkerPoint[] }> = [];
    for (const [key, n] of new Map(conflicts)) {
      const touching = clusters.filter((c) => c.points.some((p) => Math.hypot(p.x - n.point.x, p.z - n.point.z) < 1.1));
      const cluster = touching[0] ?? { keys: [], points: [] };
      if (!touching.length) clusters.push(cluster);
      cluster.keys.push(key);
      cluster.points.push(n.point);
      for (const other of touching.slice(1)) {
        cluster.keys.push(...other.keys);
        cluster.points.push(...other.points);
        clusters.splice(clusters.indexOf(other), 1);
      }
    }
    const next = new Map<string, Passage>();
    for (const c of clusters) {
      const id = c.keys.sort().join('|');
      const prior = this.passages.get(id);
      next.set(id, {
        id,
        points: c.points,
        owners: prior?.owners ?? new Set(),
        lastDirection: prior?.lastDirection ?? 0,
        lastMission: prior?.lastMission ?? '',
        served: prior?.served ?? 0,
      });
    }
    this.passages.clear();
    for (const [id, p] of next) this.passages.set(id, p);
    this.#chains = new WeakMap();
  }
  shift(x: number, z: number) {
    for (const passage of this.passages.values())
      for (const p of passage.points) {
        p.x -= x;
        p.z -= z;
      }
    this.#chains = new WeakMap();
  }
  reset() {
    this.passages.clear();
    this.#waitOrder.clear();
    this.#chains = new WeakMap();
  }
  /**
   * The passages an actor entering `first` at `arc` along `path` will request
   * before it has released every one of them: `first`, then each passage
   * reached within PASSAGE_REQUEST of the centreline while still within
   * PASSAGE_RETAIN of a passage already in the chain. Lane offsets widen both.
   * `samples` is the centreline walked, with its headings.
   */
  #chain(first: Passage, path: readonly WorkerPoint[], arc: number): Chain {
    const key = `${first.id}|${Math.round(arc / 0.25)}`;
    let cache = this.#chains.get(path);
    if (!cache) this.#chains.set(path, (cache = new Map()));
    const known = cache.get(key);
    if (known) return known;
    const chain = this.#walkChain(first, path, arc);
    cache.set(key, chain);
    return chain;
  }
  #walkChain(first: Passage, path: readonly WorkerPoint[], arc: number): Chain {
    const passages = [first],
      samples: Chain['samples'] = [],
      end = Math.min(pathLength(path), arc + 12);
    const near = (passage: Passage, q: WorkerPoint, radius: number) =>
      passage.points.some((r) => Math.hypot(q.x - r.x, q.z - r.z) < radius + PASSAGE_LANE);
    for (let s = arc; s <= end; s += 0.2) {
      const q = sampleWorkerPath(path, s);
      samples.push(q);
      for (const passage of this.passages.values())
        if (!passages.includes(passage) && near(passage, q, PASSAGE_REQUEST)) passages.push(passage);
      if (!passages.some((passage) => near(passage, q, PASSAGE_RETAIN))) break;
    }
    return { passages, samples };
  }
  /** The centreline an actor walks on from where it stands, with its headings. */
  #forward(actor: TrafficActor): Chain['samples'] {
    const samples: Chain['samples'] = [],
      end = Math.min(pathLength(actor.path), actor.distance + 12);
    for (let s = Math.max(0, actor.distance - 1); s <= end; s += 0.2) samples.push(sampleWorkerPath(actor.path, s));
    return samples;
  }
  /**
   * Whether a walker on `forward` comes through `samples` other than in
   * file: the other way, or across them. Only then can the two meet inside a
   * passage, or the walker come to need one behind the actor. A walker ahead
   * going the same way, or leaving on another road, never does. Along a file
   * its nearest points advance with the samples; they recede the other way,
   * and several samples share an inner one of them where it crosses or joins.
   */
  #conflicts(forward: Chain['samples'], samples: Chain['samples']) {
    let last = -1,
      shared = 0;
    for (const [i, sample] of samples.entries()) {
      let nearest = -1,
        gap = PASSAGE_SAME_ROAD;
      forward.forEach((q, j) => {
        const d = Math.hypot(q.x - sample.x, q.z - sample.z);
        if (d < gap) {
          gap = d;
          nearest = j;
        }
      });
      if (nearest < 0) continue;
      if (nearest < last) return true;
      // The first or last point of a forward walk gathers every sample
      // approaching it from beyond the walk's reach, and a walk touching the
      // actor's own first sample is beside it now, not across its way.
      const interior = nearest > 0 && nearest < forward.length - 1 && i > 1;
      shared = interior && nearest === last ? shared + 1 : 0;
      if (shared >= 3) return true;
      last = nearest;
    }
    return false;
  }
  step(
    actors: TrafficActor[],
    now: number,
    dt = WORKER_STEP,
    stationary: readonly WorkerPoint[] = [],
    canOccupy: (point: WorkerPoint) => boolean = () => true,
  ) {
    this.blocked = 0;
    const forwards = new Map<string, Chain['samples']>();
    const forwardOf = (actor: TrafficActor) => {
      let forward = forwards.get(actor.id);
      if (!forward) forwards.set(actor.id, (forward = this.#forward(actor)));
      return forward;
    };
    const live = new Set(actors.filter((a) => !a.done).map((a) => a.id));
    for (const p of this.passages.values())
      for (const id of p.owners)
        if (
          !live.has(id) ||
          !actors.some(
            (a) =>
              a.id === id && p.points.some((q) => Math.hypot(a.position.x - q.x, a.position.z - q.z) < PASSAGE_RETAIN),
          )
        )
          p.owners.delete(id);
    const ordered = actors
      .filter((a) => !a.done && now >= a.startAt)
      .sort((a, b) => {
        const engaged = (v: TrafficActor) => ([...this.passages.values()].some((p) => p.owners.has(v.id)) ? 0 : 1);
        return (
          engaged(a) - engaged(b) ||
          (a.waitingSince ?? this.#waitOrder.get(a.id) ?? a.startAt) -
            (b.waitingSince ?? this.#waitOrder.get(b.id) ?? b.startAt) ||
          a.direction - b.direction ||
          a.id.localeCompare(b.id)
        );
      });
    const grid = new Map<string, Array<{ position: WorkerPoint; actor: TrafficActor | undefined }>>();
    const add = (position: WorkerPoint, actor?: TrafficActor) => {
      const key = `${Math.floor(position.x)}:${Math.floor(position.z)}`;
      const bucket = grid.get(key) ?? [];
      bucket.push({ position, actor });
      grid.set(key, bucket);
    };
    for (const a of actors) if (a.visible && !a.done) add(a.position, a);
    for (const p of stationary) add(p);
    const neighbours = (p: WorkerPoint) => {
      const out: Array<{ position: WorkerPoint; actor: TrafficActor | undefined }> = [];
      for (let x = Math.floor(p.x) - 1; x <= Math.floor(p.x) + 1; x++)
        for (let z = Math.floor(p.z) - 1; z <= Math.floor(p.z) + 1; z++) out.push(...(grid.get(`${x}:${z}`) ?? []));
      return out;
    };
    const processed = new Set<string>();
    for (const actor of ordered) {
      if (processed.has(actor.id)) continue;
      const length = pathLength(actor.path);
      const base = sampleWorkerPath(actor.path, actor.distance);
      const opposite = actors.some(
        (other) =>
          other.visible &&
          other.mission !== actor.mission &&
          Math.hypot(other.position.x - actor.position.x, other.position.z - actor.position.z) < 3 &&
          (() => {
            const v = sampleWorkerPath(other.path, other.distance);
            return v.dx * base.dx + v.dz * base.dz < -0.5;
          })(),
      );
      const nearPassage = [...this.passages.values()].some((p) =>
        p.points.some((q) => Math.hypot(q.x - base.x, q.z - base.z) < 1.6),
      );
      const partner = ordered.find(
        (a) => a.mission === actor.mission && a.rank === actor.rank && a.id !== actor.id && !processed.has(a.id),
      );
      const together =
        partner &&
        Math.abs(partner.distance - actor.distance) < 0.12 &&
        Math.abs(pathLength(partner.path) - length) < 0.1 &&
        Math.hypot(partner.path[0]!.x - actor.path[0]!.x, partner.path[0]!.z - actor.path[0]!.z) < 0.1;
      const paired = Boolean(!opposite && !nearPassage && (base.width ?? 0.8) >= 0.8 && together);
      const batch = together ? [actor, partner] : [actor];
      // The lane kept for an opposing walker is for the open road and the
      // waiting line of a passage, where lanes are whole. Taken inside a
      // turn's taper, it would pin the walker beside the one turning in
      // front of it: neither could step.
      const laneTarget = (a: TrafficActor, formation: number) => {
        const here = sampleWorkerPath(
          a.path,
          Math.max(0, a.distance - (a.member ?? 0) * 0.5 * Math.cos(((a.formation ?? 0) * Math.PI) / 2)),
        );
        return opposite && here.taper >= 1
          ? 0.22
          : (a.member === 1 ? 0.22 : -0.22) * Math.sin((formation * Math.PI) / 2);
      };
      const propose = (a: TrafficActor, holdFormation = false, holdDistance = false, centre = false) => {
        let formation =
          holdFormation || holdDistance
            ? (a.formation ?? 0)
            : Math.max(0, Math.min(1, (a.formation ?? 0) + (paired ? 1 : -1) * dt * 4));
        let offset = (a.member ?? 0) * 0.5 * Math.cos((formation * Math.PI) / 2);
        const priorOffset = (a.member ?? 0) * 0.5 * Math.cos(((a.formation ?? 0) * Math.PI) / 2);
        // Formation changes must not pull a follower backwards along its route.
        let distance = holdDistance
          ? a.distance
          : Math.min(length + (a.member ?? 0) * 0.5, a.distance + a.speed * dt + Math.max(0, offset - priorOffset));
        const leader = actors.find(
          (v) => v.mission === a.mission && v.rank === a.rank && v.member === 0 && !v.done && v.path === a.path,
        );
        if (
          !paired &&
          a.member === 1 &&
          leader &&
          leader.distance - a.distance + a.member * 0.5 * Math.cos(((a.formation ?? 0) * Math.PI) / 2) < 0.5
        ) {
          // First open longitudinal room. Converging beside the leader keeps
          // both lanes occupied and can trap the opposing rank at the meeting.
          formation = a.formation ?? 0;
          offset = 0.5 * Math.cos((formation * Math.PI) / 2);
          distance = a.distance;
        }
        const target = centre ? 0 : laneTarget(a, formation);
        const lateral = holdFormation
          ? (a.lateral ?? 0)
          : (a.lateral ?? 0) + Math.max(-dt * 0.8, Math.min(dt * 0.8, target - (a.lateral ?? 0)));
        const arc = Math.max(0, distance - offset);
        return {
          actor: a,
          distance,
          formation,
          lateral,
          visible: distance >= offset,
          arc,
          point: sampleWorkerPath(a.path, arc, lateral),
        };
      };
      /** The walker whose body denied the last attempt, if any. */
      let blocker: TrafficActor | undefined;
      const attempt = (proposals: ReturnType<typeof propose>[]) => {
        const batch = proposals.map((p) => p.actor);
        let denied = false;
        const leases: Passage[] = [];
        blocker = undefined;
        for (const proposal of proposals) {
          const a = proposal.actor,
            p = proposal.point;
          if (!proposal.visible) continue;
          if (!canOccupy(p) || !canOccupy(a.position)) {
            denied = true;
            break;
          }
          for (const n of neighbours(p))
            if (
              n.actor !== a &&
              !batch.includes(n.actor!) &&
              sweptWorkerDistance(
                a.visible ? a.position : p,
                n.actor?.position ?? n.position,
                p,
                n.actor?.position ?? n.position,
              ) <
                WORKER_CLEARANCE - 0.005
            ) {
              denied = true;
              blocker = n.actor;
              break;
            }
          const other = proposals.find((v) => v.actor !== a && v.visible);
          if (
            other &&
            sweptWorkerDistance(
              a.visible ? a.position : p,
              other.actor.visible ? other.actor.position : other.point,
              p,
              other.point,
            ) <
              WORKER_CLEARANCE - 0.005
          ) {
            denied = true;
            break;
          }
          const opponents = (passage: Passage) =>
            [...passage.owners].flatMap((id) => {
              if (batch.some((a) => a.id === id)) return [];
              const owner = actors.find((v) => v.id === id);
              if (!owner) return [];
              if (owner.mission === a.mission && (owner.direction === a.direction || owner.local || a.local)) return [];
              // A connector walker stopped short of its post still holds the
              // road passage it left; held against a queue waiting for that
              // passage, nothing moves. Bodies keep the stopped walker safe.
              if (owner.local && owner.waitingSince !== null) return [];
              const cycle = cycleKey(a.path);
              if (cycle !== null && cycle === cycleKey(owner.path)) return [];
              return [owner];
            });
          const engaged = [...this.passages.values()].some((passage) => passage.owners.has(a.id));
          for (const passage of this.passages.values())
            if (passage.points.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < PASSAGE_REQUEST)) {
              // Hold-and-wait: an actor keeps a passage until it is beyond
              // PASSAGE_RETAIN of it, and requests the next from PASSAGE_REQUEST
              // away. Two opposing walkers each holding one of two passages
              // closer than that sum would wait for ever, nobody stepping
              // back. Walk on only when no passage requested before this one
              // is released is held by someone coming the other way, or
              // across; a file going the same way shares it, kept apart by
              // bodies.
              const chain = this.#chain(passage, a.path, proposal.arc);
              for (const next of chain.passages)
                if (opponents(next).some((owner) => this.#conflicts(forwardOf(owner), chain.samples))) {
                  denied = true;
                  break;
                }
              if (denied) break;
              // A free exit and the turn between directions are checked on
              // entering the chain only. Holding one passage back for them
              // would be the same hold-and-wait against whoever waits at
              // the exit; an opposing walker waits at the chain's far end.
              if (!engaged) {
                const exit = sampleWorkerPath(a.path, Math.min(length, proposal.distance + 1));
                if (
                  neighbours(exit).some(
                    (n) =>
                      n.actor !== a &&
                      !batch.includes(n.actor!) &&
                      Math.hypot(exit.x - n.position.x, exit.z - n.position.z) < WORKER_CLEARANCE,
                  )
                ) {
                  denied = true;
                  break;
                }
                const opposingWait = ordered.some(
                  (v) =>
                    v.direction !== a.direction &&
                    !v.local &&
                    v.waitingSince !== null &&
                    chain.passages.some((next) =>
                      next.points.some((q) => Math.hypot(v.position.x - q.x, v.position.z - q.z) < 1.6),
                    ),
                );
                if (passage.served >= 2 && passage.lastDirection === a.direction && opposingWait) {
                  denied = true;
                  break;
                }
              }
              leases.push(passage);
            }
        }
        if (denied) return false;
        for (const proposal of proposals) {
          const a = proposal.actor;
          a.position = proposal.point;
          a.distance = proposal.distance;
          a.formation = proposal.formation;
          a.lateral = proposal.lateral;
          a.visible = proposal.visible;
          a.waitingSince = null;
          this.#waitOrder.delete(a.id);
          if (a.visible) add(a.position, a);
          if (a.distance >= length + (a.member ?? 0) * 0.5 - 0.001) a.done = true;
        }
        for (const lease of new Set(leases)) {
          if (!batch.some((a) => lease.owners.has(a.id))) {
            lease.served =
              lease.lastDirection !== actor.direction
                ? 1
                : lease.lastMission === actor.mission
                  ? lease.served
                  : lease.served + 1;
            lease.lastDirection = actor.direction;
            lease.lastMission = actor.mission;
          }
          for (const a of batch) lease.owners.add(a.id);
        }
        return true;
      };
      for (const a of batch) processed.add(a.id);
      if (attempt(batch.map((a) => propose(a)))) continue;
      // A rank is not a rigid body. Let its leader clear a turn while the
      // follower waits; a denied lateral convergence can keep its current lane.
      for (const a of [...batch].sort((a, b) => (a.member ?? 0) - (b.member ?? 0))) {
        const following =
          (a.member ?? 0) > 0 &&
          actors.some((v) => v.mission === a.mission && v.rank === a.rank && v.member === 0 && !v.done);
        const changingLane = a.visible && Math.abs((a.lateral ?? 0) - laneTarget(a, a.formation ?? 0)) > 0.00001;
        if (attempt([propose(a)])) continue;
        // Kept to its lane by an opposing walker, an actor leaving a corner
        // drifts back out as the turn's taper fades, into the one that
        // followed it there on the inside, or turns into the lane of the one
        // beside it: neither can step. Straighten up on the spot instead; the
        // lane is taken again once there is room. Never towards the blocker:
        // a follower in the middle of the road would stand in the way of its
        // leader's connector. Never for a walker coming the other way, who
        // needs that lane.
        const pinned = blocker,
          straightened = pinned && Math.abs(a.lateral ?? 0) > 0.00001 ? propose(a, false, true, true) : undefined;
        const yields = () => {
          const h = sampleWorkerPath(
              a.path,
              Math.max(0, a.distance - (a.member ?? 0) * 0.5 * Math.cos(((a.formation ?? 0) * Math.PI) / 2)),
            ),
            theirs = sampleWorkerPath(pinned!.path, pinned!.distance);
          const gap = (q: WorkerPoint) => Math.hypot(q.x - pinned!.position.x, q.z - pinned!.position.z);
          return theirs.dx * h.dx + theirs.dz * h.dz > -0.5 && gap(straightened!.point) >= gap(a.position) - 1e-9;
        };
        if (
          (!following && attempt([propose(a, true)])) ||
          (straightened && yields() && attempt([straightened])) ||
          (changingLane && attempt([propose(a, false, true)]))
        )
          continue;
        a.waitingSince ??= now;
        this.#waitOrder.set(a.id, a.waitingSince);
        this.blocked++;
      }
    }
  }
}
