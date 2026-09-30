import type { VillageState } from '@arbestra/contracts';

type GardenPlot = NonNullable<NonNullable<VillageState['cells'][number]['building']>['garden']>['plots'][number];

export function gardenTileStage(plot: GardenPlot | undefined): number {
  if (!plot) return 1;
  if (plot.full || plot.capacity > 0 && plot.storedCarrots >= plot.capacity) return 7;
  if (plot.storedCarrots <= 0 || plot.capacity <= 0) return 1;
  return Math.min(6, 2 + Math.floor(plot.storedCarrots / plot.capacity * 5));
}
