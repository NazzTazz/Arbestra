// Reviewed synchronization ownership of all persistent sources written by the
// application. This is a classification, not a claim that every trigger/reader
// is already installed. Raw SQL and migrations are audited separately.
export const commandScopeInventory = {
  village: [
    'buildingCommandReceipts', 'buildingExpansions', 'buildingHiddenSupplies', 'buildingResourceBuffers', 'buildings',
    'depositExtractions', 'expeditionSubmissions', 'exploitationOrders', 'extractionPools', 'extractionWorksiteCommands',
    'extractionWorksiteTargets', 'extractionWorksites', 'gardenHarvests', 'gardenPlots', 'harvestIntents', 'harvestSubmissions',
    'hudWorkforceReceipts', 'infrastructureReceipts', 'levelingJobs', 'marketExchanges', 'populationCohorts',
    'populationCommandReceipts', 'processingCommandReceipts', 'processingLots', 'processingOrders',
    'scienceActivities', 'scienceContributions', 'starterPoseReceipts', 'tradeDeliveries', 'tradeJourneys', 'tradeOffers',
    'tradeReceipts', 'villageAccomplishments', 'villageInfrastructure', 'villagePopulations', 'villageResourceFlows',
    'villageResources', 'villageStarterInstallations', 'villages',
  ],
  knowledge: ['playerScience', 'sciencePlaces', 'sciencePrograms', 'scienceVillageReports'],
  spatial: ['stoneDeposits', 'woodlandDeposits', 'worldCellOccupancies', 'worldChunks', 'worldClearings',
    'worldFeatures', 'worldRc1Resources', 'worldSpawnTerraces', 'worldTerrainVertices', 'villageSpawnTerritories'],
  manifest: ['worldAtlasPresentations', 'worldFactorySettings', 'worldGenerationCandidates', 'worlds',
    'resourceTypes', 'buildingTypes', 'buildingTypeLevels', 'buildingLevelCosts', 'buildingLevelProduction',
    'buildingVariantCosts', 'processingRecipes', 'oracleMarketResources', 'terrainTypes', 'worldFeatureTypes'],
  authorization: ['accounts', 'sessions', 'worldMemberships'],
  scheduler: ['scheduledTasks', 'villageEconomyCatchups'],
};

// Secondary projections are explicit; these are not independent copies of a
// private balance. Shared occupancy, public offers and journey endpoints have
// their own representations and filtered dependencies.
export const secondaryProjections = {
  buildings: ['spatial'], buildingExpansions: ['spatial'], gardenPlots: ['spatial'],
  villageInfrastructure: ['spatial'], villages: ['spatial'],
  tradeOffers: ['offers'], tradeJourneys: ['destination-village'],
  worldTerrainVertices: ['adjacent-chunk-halos'], worldSpawnTerraces: ['adjacent-chunk-halos'],
  worldRc1Resources: ['affected-feature-chunks'],
};
