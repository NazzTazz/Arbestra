import type {ElementInput,ElementPlan} from './element-plan.js';
import type { InstallationPlan } from './installation-plan.js';
import type { Rc1ResourceState } from './rc1-field.js';
import type { SpawnPoseRequest } from '@arbestra/contracts';
import type { SpawnInspectionRequest, SpawnMap, SpawnSurface, SpawnTerrainResult, SpawnResourcePreflight } from '@arbestra/contracts';

export const RC1_CANONICAL_CHECKSUM = '5e80042349e495c504900531c189bac1912795f65e739aee09f95bdcf452a9f0';
export interface SpawnSnapshot {
  map: Omit<SpawnMap, 'landscape'>;
  artifactJSON: string;
  seed: number;
  resources?: Rc1ResourceState[] | undefined;
  spatial: { protectedSurfaces: SpawnSurface[]; walkBlockedSurfaces: SpawnSurface[] };
}
export type SpawnJob = {kind:'element';snapshot:SpawnSnapshot;input:ElementInput}
  | {kind:'installation';snapshot:SpawnSnapshot;input:SpawnPoseRequest}
  | { kind: 'map'; snapshot: SpawnSnapshot }
  | { kind: 'terrain' | 'resources'; snapshot: SpawnSnapshot; input: SpawnInspectionRequest };
export type SpawnReply = { ok: true; result: SpawnMap | SpawnTerrainResult | SpawnResourcePreflight | InstallationPlan | ElementPlan }
  | { ok: false; statusCode: number; code: string; message: string };
