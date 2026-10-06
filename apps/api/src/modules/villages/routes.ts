import { Type } from '@sinclair/typebox';
import { ScienceCommandSchema, type ScienceCommand } from '@arbestra/contracts';
import { commandVillageScience } from './service.js';
import {InfrastructureRequestSchema,type InfrastructureRequest,InfrastructurePreviewSchema} from '@arbestra/contracts';
import {infrastructureCommand,infrastructurePreview} from './infrastructure.js';
import { ProcessingCommandSchema, ProcessingPreviewSchema, type ProcessingCommand } from '@arbestra/contracts';
import { commandVillageProcessing, previewVillageProcessing } from './service.js';
import { MarketRequestSchema, MarketCommandSchema, MarketPreviewSchema, type MarketRequest, type MarketCommand } from '@arbestra/contracts';
import { commandVillageMarket, previewVillageMarket } from './service.js';
import {GardenSelectionHarvestRequestSchema,type TravelCell} from '@arbestra/contracts';
import {harvestGardenSelection} from './service.js';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';

import { CatDiscoveryResponseSchema, BuildRequestSchema, DepositDetailsSchema, ExpansionRequestSchema, ExtractionRequestSchema, ExtractionResponseSchema, ExtractionWorksiteResponseSchema, ExtractionWorksiteSelectionSchema, StartExtractionWorksiteRequestSchema, ChangeExtractionWorksiteRequestSchema, HarvestRequestSchema, PopulationCommandRequestSchema, UpgradeRequestSchema, VillageStateSchema } from '@arbestra/contracts';
import type { StartExtractionWorksiteRequest, ChangeExtractionWorksiteRequest } from '@arbestra/contracts';
import { ExploitationRequestSchema, ExploitationPreviewSchema, type ExploitationRequest } from '@arbestra/contracts';
import { previewVillageExploitation, startVillageExploitation } from './service.js';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { authenticate } from '../auth/service.js';
import { clearVillageWoodland, discoverCatEyes, constructBuilding, constructBuildingArea, discoverBuildingSupplies, expandGarden, feedPopulation, getStoneDepositDetails, getVillageState, harvestGarden, restPopulation, startVillageStoneExtraction, startVillageWorksite, previewVillageWorksite, changeVillageWorksite, upgradeBuilding } from './service.js';

const WorldParametersSchema = Type.Object({ worldSlug: Type.String({ minLength: 1, maxLength: 64 }) });
const VillageParametersSchema = Type.Object({
  worldSlug: Type.String({ minLength: 1, maxLength: 64 }),
  villageId: Type.String({ format: 'uuid' }),
});
const BuildingParametersSchema = Type.Object({
  worldSlug: Type.String({ minLength: 1, maxLength: 64 }),
  villageId: Type.String({ format: 'uuid' }),
  buildingId: Type.String({ format: 'uuid' }),
});

export async function registerVillageRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: AppConfig,
): Promise<void> {
  app.post('/api/worlds/:worldSlug/villages/:villageId/market/preview', {
    schema: { params: VillageParametersSchema, body: MarketRequestSchema, response: { 200: MarketPreviewSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return previewVillageMarket(db, account.id, worldSlug, villageId, request.body as MarketRequest);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/market', {
    schema: { params: VillageParametersSchema, body: MarketCommandSchema, response: { 200: VillageStateSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return commandVillageMarket(db, account.id, worldSlug, villageId, request.body as MarketCommand);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/processing', {
    schema: { params: VillageParametersSchema, body: ProcessingCommandSchema, response: { 200: VillageStateSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return commandVillageProcessing(db, account.id, worldSlug, villageId, request.body as ProcessingCommand);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/processing/preview', {
    schema: { params: VillageParametersSchema, body: Type.Object({ buildingId: Type.String({format:'uuid'}), workerCount: Type.Integer({minimum:1,maximum:3}),orderId:Type.Optional(Type.String({format:'uuid'})) }, {additionalProperties:false}), response: {200:ProcessingPreviewSchema} },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as {worldSlug:string;villageId:string};
    const { buildingId, workerCount, orderId } = request.body as {buildingId:string;workerCount:number;orderId?:string};
    return previewVillageProcessing(db,account.id,worldSlug,villageId,buildingId,workerCount,orderId);
  });
  for(const preview of [true,false])app.post(`/api/worlds/:worldSlug/villages/:villageId/infrastructure${preview?'/preview':''}`,{
    schema:{params:VillageParametersSchema,body:InfrastructureRequestSchema,response:{200:preview?InfrastructurePreviewSchema:VillageStateSchema}},
  },async request=>{const account=await authenticate(db,request.cookies[config.cookieName]);const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    return (preview?infrastructurePreview:infrastructureCommand)(db,account.id,worldSlug,villageId,request.body as InfrastructureRequest);});
  for (const preview of [true, false]) app.post(`/api/worlds/:worldSlug/villages/:villageId/exploitation${preview ? '/preview' : ''}`, {
    schema: { params: VillageParametersSchema, body: ExploitationRequestSchema, response: { 200: preview ? ExploitationPreviewSchema : VillageStateSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return (preview ? previewVillageExploitation : startVillageExploitation)(db, account.id, worldSlug, villageId, request.body as ExploitationRequest);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/science', {
    schema: { params: VillageParametersSchema, body: ScienceCommandSchema, response: { 200: VillageStateSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return commandVillageScience(db, account.id, worldSlug, villageId, request.body as ScienceCommand);
  });
  app.get('/api/worlds/:worldSlug/village', {
    schema: { params: WorldParametersSchema, querystring: Type.Object({ villageId: Type.Optional(Type.String({ format: 'uuid' })) }), response: { 200: VillageStateSchema } },
  }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug } = request.params as { worldSlug: string };
    return getVillageState(db, account.id, worldSlug, (request.query as { villageId?: string }).villageId);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/discover-cat-eyes', {
    schema: { params: VillageParametersSchema, response: { 200: CatDiscoveryResponseSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return discoverCatEyes(db, account.id, worldSlug, villageId);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/buildings', {
    schema: {
      params: VillageParametersSchema,
      body: BuildRequestSchema,
      response: { 201: VillageStateSchema },
    },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as {
      worldSlug: string;
      villageId: string;
    };
    const body = request.body as {houseVariant?:'stone'|'logs'|'beams'; quarterTurns?:number; commandId?: string; expectedCosts?: Array<{ resourceCode: string; amount: number }>; buildingType: string; anchorCellX?: number; anchorCellY?: number; cells?: Array<{ cellX: number; cellY: number }>; cellX?: number; cellY?: number };
    const state = body.cells ? await constructBuildingArea(
      db,
      account.id,
      worldSlug,
      villageId,
      body.buildingType,
      { cellX: body.anchorCellX!, cellY: body.anchorCellY! },
      body.cells,
      config.constructionDurationOverrideMs,
      body.commandId,
      body.expectedCosts,
      body.quarterTurns, body.houseVariant,
    ) : await constructBuilding(db, account.id, worldSlug, villageId, body.cellX!, body.cellY!, body.buildingType, config.constructionDurationOverrideMs, body.commandId, body.expectedCosts,body.quarterTurns,body.houseVariant);
    return reply.status(201).send(state);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/expansions', {
    schema: { params: BuildingParametersSchema, body: ExpansionRequestSchema, response: { 201: VillageStateSchema } },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, buildingId } = request.params as { worldSlug: string; villageId: string; buildingId: string };
    const { cells, commandId, expectedCosts } = request.body as { cells: Array<{ cellX: number; cellY: number }>; commandId?: string; expectedCosts?: Array<{ resourceCode: string; amount: number }> };
    const state = await expandGarden(db, account.id, worldSlug, villageId, buildingId, cells, config.constructionDurationOverrideMs, commandId, expectedCosts);
    return reply.status(201).send(state);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/upgrade', {
    schema: {
      params: BuildingParametersSchema,
      body: UpgradeRequestSchema,
      response: { 201: VillageStateSchema },
    },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, buildingId } = request.params as { worldSlug: string; villageId: string; buildingId: string };
    const state = await upgradeBuilding(
      db,
      account.id,
      worldSlug,
      villageId,
      buildingId,
      undefined,
      undefined,
      config.constructionDurationOverrideMs,
      (request.body as { commandId?: string }).commandId,
      (request.body as { expectedCosts?: Array<{ resourceCode: string; amount: number }> }).expectedCosts,
      (request.body as { expectedLevel?: number }).expectedLevel,
    );
    return reply.status(201).send(state);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/garden-harvests', {
    schema:{params:VillageParametersSchema,body:GardenSelectionHarvestRequestSchema,response:{200:VillageStateSchema}},
  },async request=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    const {commandId,cells}=request.body as {commandId:string;cells:TravelCell[]};
    return harvestGardenSelection(db,account.id,worldSlug,villageId,cells,commandId);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/harvest', {
    schema: { params: BuildingParametersSchema, body: HarvestRequestSchema, response: { 200: VillageStateSchema } },
  }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, buildingId } = request.params as { worldSlug: string; villageId: string; buildingId: string };
    const { commandId, cellX, cellY } = request.body as { commandId: string; cellX: number; cellY: number };
    return harvestGarden(db, account.id, worldSlug, villageId, buildingId, cellX, cellY, commandId);
  });

  app.get('/api/worlds/:worldSlug/villages/:villageId/features/:featureId', {
    schema: { params: Type.Object({ ...VillageParametersSchema.properties, featureId: Type.String({ format: 'uuid' }) }), response: { 200: DepositDetailsSchema } },
  }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, featureId } = request.params as { worldSlug: string; villageId: string; featureId: string };
    return getStoneDepositDetails(db, account.id, worldSlug, villageId, featureId);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/features/:featureId/extractions', {
    preValidation: async (request) => {
      if (request.body && typeof request.body === 'object'
        && Object.keys(request.body).some((key) => key !== 'commandId' && key !== 'workerCount'))
        throw new HttpError(400, 'VALIDATION_ERROR', 'Champs de commande interdits.');
    },
    schema: { params: Type.Object({ ...VillageParametersSchema.properties, featureId: Type.String({ format: 'uuid' }) }), body: ExtractionRequestSchema, response: { 200: ExtractionResponseSchema } },
  }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, featureId } = request.params as { worldSlug: string; villageId: string; featureId: string };
    const { commandId, workerCount } = request.body as { commandId: string; workerCount: number };
    return startVillageStoneExtraction(db, account.id, worldSlug, villageId, featureId, commandId, workerCount);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/worksites', {
    schema: { params: VillageParametersSchema, body: StartExtractionWorksiteRequestSchema,
      response: { 200: ExtractionWorksiteResponseSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return startVillageWorksite(db, account.id, worldSlug, villageId, request.body as StartExtractionWorksiteRequest);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/worksites/preview', {
    schema: { params: VillageParametersSchema, body: StartExtractionWorksiteRequestSchema,
      response: { 200: ExtractionWorksiteSelectionSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return previewVillageWorksite(db, account.id, worldSlug, villageId, request.body as StartExtractionWorksiteRequest);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/worksites/:worksiteId', {
    schema: { params: Type.Object({ ...VillageParametersSchema.properties, worksiteId: Type.String({ format: 'uuid' }) }),
      body: ChangeExtractionWorksiteRequestSchema, response: { 200: ExtractionWorksiteResponseSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, worksiteId } = request.params as { worldSlug: string; villageId: string; worksiteId: string };
    return changeVillageWorksite(db, account.id, worldSlug, villageId, worksiteId, request.body as ChangeExtractionWorksiteRequest);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/features/:featureId/clear', {
    schema: { params: Type.Object({ ...VillageParametersSchema.properties, featureId: Type.String({ format: 'uuid' }) }),
      response: { 200: VillageStateSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, featureId } = request.params as { worldSlug: string; villageId: string; featureId: string };
    return clearVillageWoodland(db, account.id, worldSlug, villageId, featureId);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/discover-supplies', {
    schema: { params: BuildingParametersSchema, response: { 200: VillageStateSchema } },
  }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, buildingId } = request.params as { worldSlug: string; villageId: string; buildingId: string };
    return discoverBuildingSupplies(db, account.id, worldSlug, villageId, buildingId);
  });

  for (const [action, handler] of [['feed', feedPopulation], ['rest', restPopulation]] as const) {
    app.post(`/api/worlds/:worldSlug/villages/:villageId/population/${action}`, {
      schema: { params: VillageParametersSchema, body: PopulationCommandRequestSchema, response: { 200: VillageStateSchema } },
    }, async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const { commandId, count } = request.body as { commandId: string; count: number };
      return handler(db, account.id, worldSlug, villageId, commandId, count);
    });
  }
}
