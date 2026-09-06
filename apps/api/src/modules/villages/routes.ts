import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';

import { BuildRequestSchema, DepositDetailsSchema, ExpansionRequestSchema, ExtractionRequestSchema, ExtractionResponseSchema, HarvestRequestSchema, PopulationCommandRequestSchema, UpgradeRequestSchema, VillageStateSchema } from '@arbestra/contracts';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { authenticate } from '../auth/service.js';
import { constructBuilding, constructBuildingArea, discoverBuildingSupplies, expandGarden, feedPopulation, getStoneDepositDetails, getVillageState, harvestGarden, restPopulation, startVillageStoneExtraction, upgradeBuilding } from './service.js';

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
  app.get('/api/worlds/:worldSlug/village', {
    schema: { params: WorldParametersSchema, response: { 200: VillageStateSchema } },
  }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug } = request.params as { worldSlug: string };
    return getVillageState(db, account.id, worldSlug);
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
    const body = request.body as { buildingType: string; anchorCellX?: number; anchorCellY?: number; cells?: Array<{ cellX: number; cellY: number }>; cellX?: number; cellY?: number };
    const state = body.cells ? await constructBuildingArea(
      db,
      account.id,
      worldSlug,
      villageId,
      body.buildingType,
      { cellX: body.anchorCellX!, cellY: body.anchorCellY! },
      body.cells,
      config.constructionDurationOverrideMs,
    ) : await constructBuilding(db, account.id, worldSlug, villageId, body.cellX!, body.cellY!, body.buildingType, config.constructionDurationOverrideMs);
    return reply.status(201).send(state);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/expansions', {
    schema: { params: BuildingParametersSchema, body: ExpansionRequestSchema, response: { 201: VillageStateSchema } },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, buildingId } = request.params as { worldSlug: string; villageId: string; buildingId: string };
    const { cells } = request.body as { cells: Array<{ cellX: number; cellY: number }> };
    const state = await expandGarden(db, account.id, worldSlug, villageId, buildingId, cells, config.constructionDurationOverrideMs);
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
    );
    return reply.status(201).send(state);
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/harvest', {
    schema: { params: BuildingParametersSchema, body: HarvestRequestSchema, response: { 200: VillageStateSchema } },
  }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId, buildingId } = request.params as { worldSlug: string; villageId: string; buildingId: string };
    const { commandId } = request.body as { commandId: string };
    return harvestGarden(db, account.id, worldSlug, villageId, buildingId, commandId);
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
