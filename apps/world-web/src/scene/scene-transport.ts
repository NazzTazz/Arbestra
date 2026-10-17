import {getTerrain,getTerrainUpdates,getTerrainOverview,getTerrainVegetationOverview,getTerrainVillages} from '../api/client';
/** Explicit read adapter: the observer never borrows the player's credentials. */
export const playerSceneTransport={getTerrain,getTerrainUpdates,getTerrainOverview,getTerrainVegetationOverview,getTerrainVillages};
export type SceneTransport=typeof playerSceneTransport&{readOnly?:true};
