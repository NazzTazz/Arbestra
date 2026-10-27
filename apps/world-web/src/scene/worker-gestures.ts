import kit from './villager-kit.json';
import type { WorkerRole } from './worker-motion';
import type { VillagerTool } from './worker-figure';

/**
 * Pure worksite gestures (docs/SPEC-CHANTIERS-ANIMES-SEQUENCES.md, sections 4, 5 and 8).
 * Times are seconds from the server work window start W0, so every player sees the
 * same plan and a reload evaluates `now` directly. Display only: nothing here
 * credits a resource or knows the village state.
 */
export interface Pose {
  /** Right and left arms: negative = forward. */
  bR: number;
  bL: number;
  /** Waist pivot: positive = leaning forward. */
  buste: number;
  jR: number;
  jL: number;
  /** Extra heading of the root, to look aside. */
  yaw: number;
}
type PoseValues = Partial<Omit<Pose, 'yaw'>>;
export type GestureName = keyof typeof kit.gestures;
export type GestureRole = 'axe' | 'wood-chop' | 'pick' | 'break';
export const ROLE_GESTURE: Record<GestureRole, GestureName> = {
  axe: 'hache',
  'wood-chop': 'fendre',
  pick: 'pioche',
  break: 'masse',
};
export const ROLE_TOOL: Record<GestureRole, VillagerTool> = {
  axe: 'hache',
  'wood-chop': 'merlin',
  pick: 'pioche',
  break: 'masse',
};
export const isGestureRole = (role: WorkerRole): role is GestureRole => role in ROLE_GESTURE;

/** Plans are drawn per 30-second block, each from its own seed, and end on a rest pose. */
export const GESTURE_BLOCK_S = 30;
/** Blend between two activities, from the prototype (seconds). */
export const GESTURE_BLEND_S = kit.blend;
const FINISH_S = 0.4;
const STRIKE = kit.strike;
const PAUSES = ['dos', 'front', 'regarde', 'neutre'] as const;

export const newPose = (): Pose => ({ bR: 0, bL: 0, buste: 0, jR: 0, jL: 0, yaw: 0 });
export function copyPose(from: Pose, to: Pose) {
  to.bR = from.bR;
  to.bL = from.bL;
  to.buste = from.buste;
  to.jR = from.jR;
  to.jL = from.jL;
  to.yaw = from.yaw;
  return to;
}
function setPose(out: Pose, p: PoseValues, legs?: PoseValues, yaw = 0) {
  out.bR = p.bR ?? 0;
  out.bL = p.bL ?? 0;
  out.buste = p.buste ?? 0;
  out.jR = p.jR ?? legs?.jR ?? 0;
  out.jL = p.jL ?? legs?.jL ?? 0;
  out.yaw = yaw;
  return out;
}
export function mixPose(a: Pose, b: Pose, t: number, out: Pose) {
  out.bR = a.bR + (b.bR - a.bR) * t;
  out.bL = a.bL + (b.bL - a.bL) * t;
  out.buste = a.buste + (b.buste - a.buste) * t;
  out.jR = a.jR + (b.jR - a.jR) * t;
  out.jL = a.jL + (b.jL - a.jL) * t;
  out.yaw = a.yaw + (b.yaw - a.yaw) * t;
  return out;
}
export const ease = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export function gestureSeed(key: string, index: number) {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return (Math.imul(seed ^ (index + 1), 2654435761) >>> 0) ^ 0x5bd1e995;
}
/** Mulberry32, so each block draws the same numbers wherever it is evaluated from. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** The i-th draw of a seed, without allocating a generator (used every frame). */
function draw(seed: number, i: number) {
  let t = (seed + Math.imul(i + 1, 0x6d2b79f5)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const blockSeed = (seed: number, block: number) => (Math.imul(seed ^ 0x9e3779b9, 31) + block * 0x85ebca6b) >>> 0;

// Scratch poses: strikes use their own, so a plan may evaluate a strike into scratchA..C.
const strikeA = newPose(),
  strikeB = newPose(),
  strikeC = newPose(),
  scratchA = newPose(),
  scratchB = newPose(),
  scratchC = newPose(),
  endPose = newPose();

/** A strike, u in [0, 1): preparation, hold, accelerated strike, impact hold, return. */
export function strikePose(u: number, gesture: GestureName, out: Pose) {
  const g = kit.gestures[gesture],
    a = STRIKE.prep,
    b = a + STRIKE.hold,
    c = b + STRIKE.strike,
    d = c + STRIKE.impact;
  const rest = setPose(strikeA, g.rest),
    prep = setPose(strikeB, g.prep),
    hit = setPose(strikeC, g.hit);
  if (u < a) return mixPose(rest, prep, ease(u / a), out);
  if (u < b) return copyPose(prep, out);
  if (u < c) {
    const x = (u - b) / STRIKE.strike;
    return mixPose(prep, hit, x * x, out);
  }
  if (u < d) return copyPose(hit, out);
  return mixPose(hit, rest, ease((u - d) / (1 - d)), out);
}

interface Segment {
  t0: number;
  t1: number;
  /** -1: strike; otherwise the index of a micro-pause in PAUSES. */
  pause: number;
  yaw: number;
}

/**
 * One villager's strikes for one gesture. Blocks are cached and rebuilt only when
 * the evaluated block changes, so a frame allocates nothing.
 */
export class StrikePlan {
  #block = -1;
  readonly #segments: Segment[] = [];
  constructor(
    readonly seed: number,
    readonly gesture: GestureName,
  ) {}
  /** Segment times in seconds from the block start. Exposed for tests. */
  segments(block: number): readonly Segment[] {
    if (block === this.#block) return this.#segments;
    this.#block = block;
    this.#segments.length = 0;
    const rand = random(blockSeed(this.seed, block)),
      period = kit.gestures[this.gesture].period,
      limit = GESTURE_BLOCK_S - 0.3;
    let s = rand() * 0.6,
      hits = 0,
      series = 4 + Math.floor(rand() * 6);
    for (;;) {
      if (hits >= series) {
        const length = 0.6 + rand() * 1.9,
          pause = Math.floor(rand() * PAUSES.length),
          yaw = (rand() < 0.5 ? -1 : 1) * 0.4;
        if (s + length > limit) break;
        this.#segments.push({ t0: s, t1: s + length, pause, yaw });
        s += length;
        hits = 0;
        series = 4 + Math.floor(rand() * 6);
        continue;
      }
      const length = period * (1 + (rand() * 2 - 1) * STRIKE.variation_cadence);
      if (s + length > limit) break;
      this.#segments.push({ t0: s, t1: s + length, pause: -1, yaw: 0 });
      s += length;
      hits++;
    }
    return this.#segments;
  }
  /** Pose at `t`; after `end` (W1) no new strike starts and the villager returns to rest. */
  pose(t: number, end: number, out: Pose): Pose {
    if (t >= end) {
      const segment = this.#at(end);
      if (segment && segment.pause < 0) {
        const start = Math.floor(end / GESTURE_BLOCK_S) * GESTURE_BLOCK_S;
        if (start + segment.t1 - end < FINISH_S) return t < start + segment.t1 ? this.#eval(t, out) : this.#rest(out);
      }
      this.#eval(end, endPose);
      return mixPose(endPose, this.#rest(scratchC), ease((t - end) / FINISH_S), out);
    }
    return this.#eval(t, out);
  }
  /** Seconds since the impact of the strike under way at `t`, Infinity before it or between strikes. */
  impactAge(t: number): number {
    const segment = this.#at(t);
    if (!segment || segment.pause >= 0) return Infinity;
    const local = t - Math.floor(t / GESTURE_BLOCK_S) * GESTURE_BLOCK_S,
      impact = segment.t0 + STRIKE.impact_u * (segment.t1 - segment.t0);
    return local >= impact ? local - impact : Infinity;
  }
  #rest(out: Pose) {
    return setPose(out, kit.gestures[this.gesture].rest);
  }
  #at(t: number) {
    const block = Math.floor(t / GESTURE_BLOCK_S),
      local = t - block * GESTURE_BLOCK_S;
    for (const s of this.segments(block)) if (local >= s.t0 && local < s.t1) return s;
    return null;
  }
  #eval(t: number, out: Pose) {
    const local = t - Math.floor(t / GESTURE_BLOCK_S) * GESTURE_BLOCK_S,
      segment = this.#at(t);
    if (!segment) return this.#rest(out);
    const u = (local - segment.t0) / (segment.t1 - segment.t0);
    if (segment.pause < 0) return strikePose(u, this.gesture, out);
    const rest = kit.gestures[this.gesture].rest,
      length = segment.t1 - segment.t0,
      ramp = Math.min(0.4, length / 2),
      w = ease((local - segment.t0) / ramp) * ease((segment.t1 - local) / ramp);
    const name = PAUSES[segment.pause]!;
    setPose(scratchA, rest);
    setPose(scratchB, kit.poses[name], rest, name === 'regarde' ? segment.yaw : 0);
    return mixPose(scratchA, scratchB, w, out);
  }
}

/**
 * Two-handed saw stroke shared by a pair, in [-1, 1], 0 during the pair's pauses.
 * Both sawyers and the blade read the same stroke, the second sawyer in opposite phase.
 */
export function sawStroke(seed: number, t: number) {
  const block = Math.floor(t / GESTURE_BLOCK_S),
    local = t - block * GESTURE_BLOCK_S,
    bs = blockSeed(seed, block);
  let s = 0;
  for (let i = 0; s < GESTURE_BLOCK_S; i += 2) {
    const run = 6 + draw(bs, i) * 8,
      pause = 0.8 + draw(bs, i + 1) * 1.2;
    if (local < s + run) {
      const ramp = ease((local - s) / 0.3) * ease((Math.min(s + run, GESTURE_BLOCK_S) - local) / 0.3);
      return Math.sin((2 * Math.PI * t) / kit.saw.period) * ramp;
    }
    s += run;
    if (local < s + pause) return 0;
    s += pause;
  }
  return 0;
}
/** Figurine arm chain, from the kit: waist pivot above the ground, waist → shoulder, shoulder → hand centre. */
const WAIST_HEIGHT = 0.215 + kit.pivots.waist,
  SHOULDER = kit.pivots.arm[1]!,
  HAND = 0.225;
/**
 * Where the sawyers hold the saw: handle height above the ground, mean forward reach
 * from the body axis and stroke amplitude, both along the saw line. The saw mesh uses
 * the same values, so the handles stay in the hands.
 */
export const SAW_GRIP = { height: 0.42, reach: 0.26, stroke: 0.09 } as const;
/** Hand position (forward, height above the ground) for a pose's waist and arm angles. */
export function handPoint(buste: number, arm: number) {
  return {
    forward: SHOULDER * Math.sin(buste) - HAND * Math.sin(arm + buste),
    height: WAIST_HEIGHT + SHOULDER * Math.cos(buste) - HAND * Math.cos(arm + buste),
  };
}
/**
 * The saw moves along the line between the sawyers: a positive stroke pushes it from
 * the first sawyer towards the partner. The hands follow it at the handle height, the
 * waist leaning into the push and back on the pull (two-link inverse kinematics).
 */
export function sawPose(stroke: number, partner: boolean, out: Pose) {
  const w = partner ? -stroke : stroke,
    reach = SAW_GRIP.reach + SAW_GRIP.stroke * w,
    up = SAW_GRIP.height - WAIST_HEIGHT,
    d = Math.hypot(reach, up),
    gamma = Math.acos(Math.min(1, (SHOULDER * SHOULDER + d * d - HAND * HAND) / (2 * SHOULDER * d))),
    buste = Math.atan2(reach, up) - gamma,
    alpha = Math.atan2(reach - SHOULDER * Math.sin(buste), SHOULDER * Math.cos(buste) - up),
    arm = -alpha - buste;
  return setPose(out, { bR: arm, bL: arm, buste, jR: -0.15 - 0.1 * w, jL: 0.15 });
}

export function walkPose(walk: number, loaded: boolean, out: Pose) {
  const swing = Math.sin(walk) * (loaded ? 0.35 : 0.5);
  if (loaded) setPose(out, kit.poses.porter);
  else setPose(out, { bR: -swing * 0.8, bL: swing * 0.8, buste: 0.04 });
  out.jR = swing;
  out.jL = -swing;
  return out;
}
export function carryPose(out: Pose) {
  return setPose(out, kit.poses.porter);
}

/**
 * Alternating tasks of small teams, without the former 12-second site cycle:
 * each 30-second block shares its time between the tasks, with drawn proportions.
 */
export function teamActivity(seed: number, resource: string, count: number, role: WorkerRole, t: number): WorkerRole {
  const block = Math.floor(t / GESTURE_BLOCK_S),
    local = (t - block * GESTURE_BLOCK_S) / GESTURE_BLOCK_S,
    jitter = (draw(blockSeed(seed ^ 0x2545f491, block), 0) * 2 - 1) * 0.08;
  if (resource === 'stone' || resource === 'leveling') {
    if (count === 1) return local < 0.5 + jitter ? 'pick' : local < 0.83 + jitter / 2 ? 'break' : 'carry';
    if (count === 2 && role === 'break') return local < 0.67 + jitter ? 'break' : 'carry';
  }
  if (resource === 'wood' && count <= 2 && (role === 'axe' || role === 'saw'))
    return local < 0.67 + jitter ? role : 'wood-chop';
  return role;
}

const GARDEN = { lean: 0.35, pull: 0.35, rise: 0.4, back: 0.4 };
const GARDEN_SEQUENCE = GARDEN.lean + GARDEN.pull + GARDEN.rise + GARDEN.back;
const GARDEN_RISE: PoseValues = { bR: -0.6, bL: -0.2, buste: 0.45 };
export const GARDEN_TUFTS = 12;
const GARDEN_WALK_S = 0.8;
function gardenScale(duration: number) {
  const interval = duration / GARDEN_TUFTS;
  return Math.min(interval < 2.4 ? 0.7 : 1, (interval * 0.9) / GARDEN_SEQUENCE);
}
/** Instant at which tuft k disappears, as `round(12 × (1 − p))` decreases (garden-kit.ts). */
export const gardenTuftTime = (k: number, duration: number) => ((k + 0.5) / GARDEN_TUFTS) * duration;

/**
 * The gardener's gesture: lean, pull exactly when tuft k disappears, straighten and
 * drop it in the basket; weeding or looking at the row fill longer intervals.
 * Returns whether the carrot is in hand.
 */
export function gardenPose(seed: number, t: number, duration: number, out: Pose): boolean {
  const interval = duration / GARDEN_TUFTS,
    scale = gardenScale(duration),
    k = Math.max(0, Math.min(GARDEN_TUFTS - 1, Math.round(t / interval - 0.5))),
    u = (t - gardenTuftTime(k, duration)) / scale;
  const neutral = setPose(scratchA, kit.poses.neutre);
  if (u >= -GARDEN.lean && u < GARDEN_SEQUENCE - GARDEN.lean && t <= duration + GARDEN_SEQUENCE) {
    const pull = GARDEN.pull,
      rise = pull + GARDEN.rise;
    if (u < 0) mixPose(neutral, setPose(scratchB, kit.poses.penche), ease(u / GARDEN.lean + 1), out);
    else if (u < pull)
      mixPose(setPose(scratchB, kit.poses.penche), setPose(scratchC, kit.poses.arrache), ease(u / pull), out);
    else if (u < rise)
      mixPose(
        setPose(scratchB, kit.poses.arrache),
        setPose(scratchC, GARDEN_RISE),
        ease((u - pull) / GARDEN.rise),
        out,
      );
    else mixPose(setPose(scratchB, GARDEN_RISE), neutral, ease((u - rise) / GARDEN.back), out);
    return u >= 0 && u < rise;
  }
  // Between two sequences: weed, look at the row, or stand.
  const previous = u >= 0 ? k : k - 1,
    next = previous + 1,
    start = previous >= 0 ? gardenTuftTime(previous, duration) + (GARDEN_SEQUENCE - GARDEN.lean) * scale : 0,
    gapEnd = next < GARDEN_TUFTS ? gardenTuftTime(next, duration) - GARDEN.lean * scale : duration;
  if (t >= duration || gapEnd - start < 3) {
    copyPose(neutral, out);
    return false;
  }
  const bs = blockSeed(seed, next),
    weed = draw(bs, 0) < 0.6,
    yaw = (draw(bs, 1) < 0.5 ? -1 : 1) * 0.35,
    w = ease((t - start - 0.4) / 0.4) * ease((gapEnd - 0.4 - t) / 0.4);
  if (weed) {
    setPose(scratchB, { bR: -0.5 + Math.sin(t * 7) * 0.15, bL: -0.3, buste: 0.9, jR: -0.1, jL: 0.1 });
  } else setPose(scratchB, kit.poses.regarde, undefined, yaw);
  mixPose(neutral, scratchB, w, out);
  return false;
}

/**
 * Display progress along the garden sweep: the gardener stops at each tuft for
 * its gesture and walks between them, so the pull is not made while walking.
 */
export function gardenStride(progress: number, duration: number) {
  const p = Math.max(0, Math.min(1, progress)),
    scale = gardenScale(duration),
    before = (GARDEN.lean * scale) / Math.max(1, duration),
    after = ((GARDEN_SEQUENCE - GARDEN.lean) * scale) / Math.max(1, duration),
    centre = (k: number) => (k + 0.5) / GARDEN_TUFTS,
    k = Math.max(0, Math.min(GARDEN_TUFTS - 1, Math.round(p * GARDEN_TUFTS - 0.5))),
    a = centre(k) - before,
    b = centre(k) + after;
  if (p >= a && p <= b) return centre(k);
  // Between two tufts he stays, then walks at most WALK_S to the next one.
  const walk = (x0: number, v0: number, x1: number, v1: number) => {
    const from = Math.max(x0, x1 - GARDEN_WALK_S / Math.max(1, duration));
    return p <= from || x1 <= from ? (p < x1 ? v0 : v1) : v0 + ((v1 - v0) * (p - from)) / (x1 - from);
  };
  if (p < a) return k > 0 ? walk(centre(k - 1) + after, centre(k - 1), a, centre(k)) : walk(0, 0, a, centre(k));
  if (k < GARDEN_TUFTS - 1) return walk(b, centre(k), centre(k + 1) - before, centre(k + 1));
  return b >= 1 ? 1 : centre(k) + ((1 - centre(k)) * (p - b)) / (1 - b);
}
