export const WORLD_GENERATION_V2 = {
  version: 2,
  clearing: {
    targetCount: 600,
    innerRadius: 12,
    transitionRadius: 4,
    minimumCenterDistance: 40,
    spawnCoreRadius: 2,
    depositOuterRadius: 8,
  },
  terrain: {
    broadScale: 64,
    detailScale: 16,
    maximumElevation: 20,
    waterThreshold: 0.27,
    rockyElevationThreshold: 0.7,
    rockyMoistureThreshold: 0.46,
  },
  features: {
    woodlandDensity: 0.018,
    stoneOutcropDensity: 0.003,
    clearingDeposits: [
      'woodland',
      'woodland',
      'stone_outcrop',
      'woodland',
    ],
  },
} as const;
