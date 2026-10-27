/**
 * Worksite material of a wood site (docs/SPEC-CHANTIERS-ANIMES-SEQUENCES.md §4, §6):
 * the felled tree, the trunk cut into sections and the pile of logs. Pure, in
 * seconds from W0 (start of the server work window), identical for every
 * player and after F5. Presentation only: none of it is a resource.
 */

/** Sections of the felled trunk, cut at even steps between landing and W1. */
export const WOOD_SECTIONS = 6;
/** Logs of a full pile, three levels of 4, 3 and 2. */
export const PILE_LOGS = 9;
/** Planned fall: W0 + min(10 s, 12 % of the window). */
const FALL_PLANNED_S = 10;
const FALL_PLANNED_SHARE = 0.12;
/** A late feller fells after three visible strikes, at most until 30 % of the window. */
const FALL_LATEST_SHARE = 0.3;
const FALL_STRIKES_S = 3 * 1.6;
/** Tilt of 90° in 1.2 s, angle in t², then a bounce of 0.08 rad. */
export const FALL_S = 1.2;
const BOUNCE_S = 0.5;
const BOUNCE_RAD = 0.08;

/**
 * When the tree falls, in seconds from W0. `fellerAt` is when the feller
 * reached its post (seconds from W0), unknown while it is still walking.
 */
export const woodPlannedFall = (duration: number) => Math.min(FALL_PLANNED_S, FALL_PLANNED_SHARE * duration);
export function woodFallAt(duration: number, fellerAt: number | null): number {
  const planned = woodPlannedFall(duration),
    latest = FALL_LATEST_SHARE * duration;
  if (fellerAt === null) return latest;
  return Math.max(planned, Math.min(latest, fellerAt + FALL_STRIKES_S));
}

export interface WoodSiteState {
  /** Tilt of the tree from upright, in radians: 0 standing, π/2 lying. */
  tilt: number;
  /** Sections of the lying trunk still to cut, WOOD_SECTIONS while standing. */
  sections: number;
  /** Logs on the pile, 0 to PILE_LOGS. */
  logs: number;
}

/**
 * State at `t` seconds from W0 over a window of `duration` seconds. `seenFrom`
 * is when the site was first shown: a fall already due then is never replayed.
 */
export function woodSite(duration: number, t: number, fallAt: number, seenFrom: number): WoodSiteState {
  const p = duration > 0 ? Math.max(0, Math.min(1, t / duration)) : 1;
  const since = t - fallAt;
  let tilt: number;
  if (since < 0) tilt = 0;
  else if (seenFrom > fallAt || since >= FALL_S + BOUNCE_S) tilt = Math.PI / 2;
  else if (since < FALL_S) tilt = (Math.PI / 2) * (since / FALL_S) ** 2;
  else {
    const u = (since - FALL_S) / BOUNCE_S;
    tilt = Math.PI / 2 - BOUNCE_RAD * Math.sin(Math.PI * u) * (1 - u);
  }
  // Sections are cut over the window left once the tree lies, so none is cut
  // the instant it lands; W1 still leaves nothing of the trunk.
  const landed = Math.min(duration, fallAt + FALL_S),
    cut = duration > landed ? Math.max(0, Math.min(1, (t - landed) / (duration - landed))) : 1;
  return {
    tilt,
    sections: t >= duration ? 0 : WOOD_SECTIONS - Math.min(WOOD_SECTIONS, Math.floor(cut * WOOD_SECTIONS)),
    logs: Math.min(PILE_LOGS, Math.floor(p * PILE_LOGS + 1e-9)),
  };
}

/** Place of the i-th log of the pile: level and position along it, centred. */
export function pileSlot(i: number): { level: number; along: number } {
  const level = i < 4 ? 0 : i < 7 ? 1 : 2,
    first = level === 0 ? 0 : level === 1 ? 4 : 7,
    size = level === 0 ? 4 : level === 1 ? 3 : 2;
  return { level, along: i - first - (size - 1) / 2 };
}
