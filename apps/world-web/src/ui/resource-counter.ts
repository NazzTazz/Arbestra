import type { VillageState } from '@arbestra/contracts';

const numbers = new Intl.NumberFormat('fr-FR');
export const formatResourceAmount = (amount: number): string => numbers.format(Math.floor(amount));

/** Display projection only; the accepted server snapshot remains authoritative. */
export function projectedWood(
  village: Pick<VillageState['village'], 'wood' | 'woodProductionPerHour'>,
  serverTime: string,
  serverNow: number,
): number {
  return Math.floor(
    village.wood + (village.woodProductionPerHour * Math.max(0, serverNow - Date.parse(serverTime))) / 3_600_000,
  );
}
