import type { BuildingPlan, Stone } from './building-plan';

/** Join masonry lattice fragments into horizontal timbers, retaining real openings.
 * Alternating through courses form the corner interlock; only their exposed ends protrude. */
export function timberWallMembers(plan: BuildingPlan): Stone[] {
  const rows = new Map<string, Stone[]>();
  for (const stone of plan.stones) {
    const key = `${stone.axis}:${stone.y}:${stone.axis === 'x' ? stone.z : stone.x}`;
    const row = rows.get(key) ?? []; row.push(stone); rows.set(key, row);
  }
  const result: Stone[] = [];
  for (const row of rows.values()) {
    const axis = row[0]!.axis;
    row.sort((a,b) => a[axis] - b[axis]);
    const merged: Stone[] = [];
    for (const stone of row) {
      const last = merged.at(-1);
      if (last && Math.abs(stone[axis] - stone.length / 2 - last[axis] - last.length / 2 - plan.recipe.module.joint) < 1e-6) {
        const lo = last[axis] - last.length / 2, hi = stone[axis] + stone.length / 2;
        last[axis] = (lo + hi) / 2; last.length = hi - lo;
      } else merged.push({...stone});
    }
    const half = (axis === 'x' ? plan.width : plan.depth) / 2;
    for (const member of merged) {
      let lo = member[axis] - member.length / 2, hi = member[axis] + member.length / 2;
      if (Math.abs(lo + half) < .005) lo -= .09;
      if (Math.abs(hi - half) < .005) hi += .09;
      member[axis] = (lo + hi) / 2; member.length = hi - lo;
      result.push(member);
    }
  }
  return result;
}
