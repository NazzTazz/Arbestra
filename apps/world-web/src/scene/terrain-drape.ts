import type { TravelCell } from '@arbestra/contracts';
import type { WorldSpace } from './world-space';
/** Lift local surface geometry onto the continuous rendered field. Heights are Babylon units. */
export function drapePositions(
  positions: number[],
  space: WorldSpace,
  ground: (cell: TravelCell) => { height: number } | null,
  lift = 0.04,
): void {
  for (let i = 0; i < positions.length; i += 3) {
    const c = space.inverse(positions[i]!, positions[i + 2]!),
      h = ground(c)?.height;
    if (h !== undefined) positions[i + 1]! += h + lift;
  }
}
