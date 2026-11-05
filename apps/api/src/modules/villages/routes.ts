import { observationCommitted } from '../admin/observation-actions.js';
import {
  RoadCellsConfirmationV2Schema,
  RoadCellsPreviewRequestSchema,
  RoadCellsPreviewSchema,
  RoadCellsRequestSchema,
  DemolitionRequestSchema,
  DemolitionConfirmationV2Schema,
  type DemolitionRequest,
  TerrainEditsRequestSchema,
  TerrainEditsConfirmationV2Schema,
  type TerrainEditsRequest,
  type RoadCellsPreviewRequest,
  type RoadCellsRequest,
  RoadAnchorsConfirmationV2Schema,
  RoadAnchorsPreviewRequestSchema,
  RoadAnchorsPreviewSchema,
  RoadAnchorsRequestSchema,
  type RoadAnchorsPreviewRequest,
  type RoadAnchorsRequest,
} from '@arbestra/contracts';
import { previewRoadCells, roadCellsCommandV2 } from './road-cells.js';
import { demolitionCommandV2 } from './demolition.js';
import { terrainEditsCommandV2 } from './terrain-edits.js';
import { previewRoadAnchors, roadAnchorsCommandV2 } from './road-anchors.js';
import { receiveExpedition } from '../science/expeditions.js';
import { ExpeditionReceiptSchema, type ExpeditionIntent } from '@arbestra/contracts';
import {
  HarvestCancelReceiptSchema,
  HarvestIntentSchema,
  HarvestReceiptSchema,
  type HarvestIntent,
} from '@arbestra/contracts';
import { receiveHarvestIntent } from './harvest-submissions.js';
import { cancelHarvestIntent } from './harvest-cancellations.js';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  ExtractionPoolCommandSchema,
  PopulationGestureSchema,
  HudWorkforceConfirmationV2Schema,
  type ExtractionPoolCommand,
  type HudWorkforceIntent,
  type PopulationGesture,
} from '@arbestra/contracts';
import { commandHudWorkforceV2 } from './hud-workforce.js';
import { ScienceCommandSchema, type ScienceCommand } from '@arbestra/contracts';
import { commandVillageScience } from './service.js';
import { ProcessingCommandSchema, ProcessingPreviewSchema, type ProcessingCommand } from '@arbestra/contracts';
import { previewVillageProcessing } from './service.js';
import {
  CommandReceiptReadSchema,
  CommandReceiptReadResponseSchema,
  type CommandReceiptRead,
} from '@arbestra/contracts';
import { readCommandReceipts } from './command-receipts.js';
import { ProcessingConfirmationV2Schema } from '@arbestra/contracts';
import { commandProcessingV2 } from './processing-v2.js';
import { expandGardenV2, placeBuildingV2, upgradeBuildingV2 } from './construction-v2.js';
import type { BuildingType } from '@arbestra/contracts';
import { assertSyncV2Available } from './sync-v2-routes.js';
import { TradeCommandSchema, TradePageSchema, TradePreviewSchema, type TradeCommand } from '@arbestra/contracts';
import { commandPlayerMarket, browsePlayerMarket, previewPlayerTrade } from './trade-service.js';
import type { NavigationExecutor } from '../navigation/compute.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AfterConstructionWrites, ConstructionCommit } from './service.js';
import { discoverBuildingSuppliesInTransaction } from './service.js';
import { spatialTransaction } from '../worlds/spatial-locks.js';
import { ConstructionConfirmationV2Schema, VillageCommandConfirmationV2Schema } from '@arbestra/contracts';
import { villageCommandV2 } from './command-v2.js';
import type { TravelNetworkExecutor } from '../navigation/network-job.js';
import type { Kysely } from 'kysely';

import {
  BuildRequestSchema,
  DepositDetailsSchema,
  ExpansionRequestSchema,
  ChangeExtractionWorksiteRequestSchema,
  UpgradeRequestSchema,
} from '@arbestra/contracts';
import type { ChangeExtractionWorksiteRequest } from '@arbestra/contracts';
import { ExploitationRequestSchema, ExploitationPreviewSchema, type ExploitationRequest } from '@arbestra/contracts';
import { previewVillageExploitation, startVillageExploitation } from './service.js';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { authenticate } from '../auth/service.js';
import {
  registerRetiredVillageReads,
  requireProtocolV2,
  requireProtocolV2ExceptExpeditions,
} from './client-protocol.js';
import { discoverCatEyes, getStoneDepositDetails, changeVillageWorksite } from './service.js';

const VillageParametersSchema = Type.Object({
  worldSlug: Type.String({ minLength: 1, maxLength: 64 }),
  villageId: Type.String({ format: 'uuid' }),
});
const BuildingParametersSchema = Type.Object({
  worldSlug: Type.String({ minLength: 1, maxLength: 64 }),
  villageId: Type.String({ format: 'uuid' }),
  buildingId: Type.String({ format: 'uuid' }),
});

/** Every command answers on the V2 contract: the protocol and stream generation
 * travel in headers (a client without the protocol header is refused by
 * `requireProtocolV2`), and gestures without a body identifier carry the
 * client's UUID in `x-arbestra-command`. */
const VillageCommandV2HeadersSchema = Type.Object(
  {
    'x-arbestra-protocol': Type.Optional(Type.Literal('2')),
    'x-arbestra-generation': Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,15})$' })),
    'x-arbestra-command': Type.Optional(Type.String({ format: 'uuid' })),
  },
  { additionalProperties: true },
);

export async function registerVillageRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: AppConfig,
  navigation: TravelNetworkExecutor,
): Promise<void> {
  // The historical village read and event stream: an old tab is told to reload.
  registerRetiredVillageReads(app);
  /** Answers a gesture on the V2 contract. */
  const villageV2 = async (
    request: FastifyRequest,
    reply: FastifyReply,
    run: (afterWrites: AfterConstructionWrites) => Promise<ConstructionCommit>,
    commandId = request.headers['x-arbestra-command'] as string | undefined,
  ) => {
    await assertSyncV2Available(db);
    const confirmation = await villageCommandV2(
      commandId,
      Number(request.headers['x-arbestra-generation'] ?? '0'),
      run,
    );
    observationCommitted(request);
    return reply.serializer(JSON.stringify).send(confirmation);
  };
  // Workforce HUD gestures: the result and the private effects of the commit.
  const hudGesture = async (request: FastifyRequest, reply: FastifyReply, intent: HudWorkforceIntent) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    await assertSyncV2Available(db);
    const confirmation = await commandHudWorkforceV2(
      db,
      account.id,
      worldSlug,
      villageId,
      intent,
      Number(request.headers['x-arbestra-generation'] ?? '0'),
    );
    observationCommitted(request);
    return reply.serializer(JSON.stringify).send(confirmation);
  };
  const hudSchema = {
    params: VillageParametersSchema,
    headers: VillageCommandV2HeadersSchema,
    response: { 200: HudWorkforceConfirmationV2Schema },
  };
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/extraction-pools',
    { onRequest: requireProtocolV2, schema: { ...hudSchema, body: ExtractionPoolCommandSchema } },
    (request, reply) => hudGesture(request, reply, { kind: 'pool', command: request.body as ExtractionPoolCommand }),
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/population/gestures',
    { onRequest: requireProtocolV2, schema: { ...hudSchema, body: PopulationGestureSchema } },
    (request, reply) => hudGesture(request, reply, { kind: 'population', command: request.body as PopulationGesture }),
  );
  const tradeNavigation = navigation as TravelNetworkExecutor & NavigationExecutor;
  app.get(
    '/api/worlds/:worldSlug/villages/:villageId/market/offers',
    {
      schema: {
        params: VillageParametersSchema,
        querystring: Type.Object({
          mine: Type.Optional(Type.Boolean()),
          cursor: Type.Optional(Type.String({ format: 'uuid' })),
        }),
        response: { 200: TradePageSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const { mine, cursor } = request.query as { mine?: boolean; cursor?: string };
      return browsePlayerMarket(db, account.id, worldSlug, villageId, !!mine, cursor);
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/market/trade-preview',
    {
      schema: {
        params: VillageParametersSchema,
        body: Type.Object({ offerId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
        response: { 200: TradePreviewSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      return previewPlayerTrade(
        db,
        account.id,
        worldSlug,
        villageId,
        (request.body as { offerId: string }).offerId,
        tradeNavigation,
      );
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/market/trades',
    {
      onRequest: requireProtocolV2,
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: TradeCommandSchema,
        response: { 200: VillageCommandConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const command = request.body as TradeCommand;
      return villageV2(
        request,
        reply,
        (afterWrites) =>
          commandPlayerMarket(db, account.id, worldSlug, villageId, command, tradeNavigation, afterWrites),
        command.commandId,
      );
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/harvest-intents',
    {
      schema: { params: VillageParametersSchema, body: HarvestIntentSchema, response: { 200: HarvestReceiptSchema } },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      return receiveHarvestIntent(db, account.id, worldSlug, villageId, request.body as HarvestIntent);
    },
  );
  // « Annuler » a gesture of the wood queue, idempotent by the gesture's commandId.
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/harvest-intents/:commandId/cancel',
    {
      schema: {
        params: Type.Object({ ...VillageParametersSchema.properties, commandId: Type.String({ format: 'uuid' }) }),
        response: { 200: HarvestCancelReceiptSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId, commandId } = request.params as {
        worldSlug: string;
        villageId: string;
        commandId: string;
      };
      const receipt = await cancelHarvestIntent(db, account.id, worldSlug, villageId, commandId);
      observationCommitted(request);
      return receipt;
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/commands/receipts/read',
    {
      bodyLimit: 16 * 1024,
      // Fastify's historical AJV configuration removes additional fields.
      // This bounded protocol rejects them before that coercion can occur.
      preValidation: async (request) => {
        if (!Value.Check(CommandReceiptReadSchema, request.body))
          throw new HttpError(400, 'INVALID_RECEIPT_SELECTION', 'Sélection de reçus invalide.');
      },
      schema: {
        params: VillageParametersSchema,
        body: CommandReceiptReadSchema,
        response: { 200: CommandReceiptReadResponseSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      return readCommandReceipts(db, account.id, worldSlug, villageId, request.body as CommandReceiptRead);
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/processing',
    {
      onRequest: requireProtocolV2,
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: ProcessingCommandSchema,
        response: { 200: ProcessingConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      await assertSyncV2Available(db);
      const generation = Number(request.headers['x-arbestra-generation'] ?? '0');
      if (!Number.isSafeInteger(generation))
        throw new HttpError(400, 'INVALID_SYNC_GENERATION', 'Génération invalide.');
      const result = await commandProcessingV2(
        db,
        account.id,
        worldSlug,
        villageId,
        request.body as ProcessingCommand,
        generation,
      );
      observationCommitted(request);
      // Same wire encoding as the V2 stream. fast-json-stringify compiles
      // the component unions lazily: seconds on the first command of a process.
      return reply.serializer(JSON.stringify).send(result);
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/processing/preview',
    {
      schema: {
        params: VillageParametersSchema,
        body: Type.Object(
          {
            buildingId: Type.String({ format: 'uuid' }),
            workerCount: Type.Integer({ minimum: 1, maximum: 3 }),
            orderId: Type.Optional(Type.String({ format: 'uuid' })),
          },
          { additionalProperties: false },
        ),
        response: { 200: ProcessingPreviewSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const { buildingId, workerCount, orderId } = request.body as {
        buildingId: string;
        workerCount: number;
        orderId?: string;
      };
      return previewVillageProcessing(db, account.id, worldSlug, villageId, buildingId, workerCount, orderId);
    },
  );
  // Road cells (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md §4): V2-native,
  // one bounded command per gesture; the quote is a read-only projection.
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/road-cells/preview',
    {
      schema: {
        params: VillageParametersSchema,
        body: RoadCellsPreviewRequestSchema,
        response: { 200: RoadCellsPreviewSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      return previewRoadCells(db, account.id, worldSlug, villageId, request.body as RoadCellsPreviewRequest);
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/road-cells',
    {
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: RoadCellsRequestSchema,
        response: { 200: RoadCellsConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      await assertSyncV2Available(db);
      const confirmation = await roadCellsCommandV2(
        db,
        account.id,
        worldSlug,
        villageId,
        request.body as RoadCellsRequest,
        Number(request.headers['x-arbestra-generation'] ?? '0'),
      );
      observationCommitted(request);
      return reply.serializer(JSON.stringify).send(confirmation);
    },
  );
  // Instant terrain edits (docs/SPEC-TERRAFORMATION-INSTANTANEE.md): V2-native,
  // one batch of gestures per command, applied at admission.
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/terrain-edits',
    {
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: TerrainEditsRequestSchema,
        response: { 200: TerrainEditsConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      await assertSyncV2Available(db);
      const confirmation = await terrainEditsCommandV2(
        db,
        account.id,
        worldSlug,
        villageId,
        request.body as TerrainEditsRequest,
        Number(request.headers['x-arbestra-generation'] ?? '0'),
      );
      observationCommitted(request);
      return reply.serializer(JSON.stringify).send(confirmation);
    },
  );
  // Demolition (docs/SPEC-DEMOLITION.md §9): V2-native, immediate, one
  // bounded command per designation.
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/demolitions',
    {
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: DemolitionRequestSchema,
        response: { 200: DemolitionConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      await assertSyncV2Available(db);
      const confirmation = await demolitionCommandV2(
        db,
        account.id,
        worldSlug,
        villageId,
        request.body as DemolitionRequest,
        Number(request.headers['x-arbestra-generation'] ?? '0'),
      );
      observationCommitted(request);
      return reply.serializer(JSON.stringify).send(confirmation);
    },
  );
  // Road anchors and accessories (docs/SPEC-INFRASTRUCTURE-CASES-ET-PLACES.md
  // §5.1): V2-native, one bounded command per gesture; read-only quote.
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/road-anchors/preview',
    {
      schema: {
        params: VillageParametersSchema,
        body: RoadAnchorsPreviewRequestSchema,
        response: { 200: RoadAnchorsPreviewSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      return previewRoadAnchors(db, account.id, worldSlug, villageId, request.body as RoadAnchorsPreviewRequest);
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/road-anchors',
    {
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: RoadAnchorsRequestSchema,
        response: { 200: RoadAnchorsConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      await assertSyncV2Available(db);
      const confirmation = await roadAnchorsCommandV2(
        db,
        account.id,
        worldSlug,
        villageId,
        request.body as RoadAnchorsRequest,
        Number(request.headers['x-arbestra-generation'] ?? '0'),
      );
      observationCommitted(request);
      return reply.serializer(JSON.stringify).send(confirmation);
    },
  );
  for (const preview of [true, false])
    app.post(
      `/api/worlds/:worldSlug/villages/:villageId/exploitation${preview ? '/preview' : ''}`,
      {
        // The preview is a read with no historical twin: no protocol header.
        ...(preview ? {} : { onRequest: requireProtocolV2 }),
        schema: {
          params: VillageParametersSchema,
          headers: VillageCommandV2HeadersSchema,
          body: ExploitationRequestSchema,
          response: { 200: preview ? ExploitationPreviewSchema : VillageCommandConfirmationV2Schema },
        },
      },
      async (request, reply) => {
        const account = await authenticate(db, request.cookies[config.cookieName]);
        const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
        const order = request.body as ExploitationRequest;
        if (preview) return previewVillageExploitation(db, account.id, worldSlug, villageId, order);
        // The order's own UUID identifies the gesture.
        return villageV2(
          request,
          reply,
          (afterWrites) => startVillageExploitation(db, account.id, worldSlug, villageId, order, afterWrites),
          order.commandId,
        );
      },
    );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/science',
    {
      // Expedition receipts (survey, explore) carry no protocol header; the rest does.
      preValidation: requireProtocolV2ExceptExpeditions,
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: ScienceCommandSchema,
        response: {
          200: Type.Union([ExpeditionReceiptSchema, VillageCommandConfirmationV2Schema]),
          202: ExpeditionReceiptSchema,
        },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const command = request.body as ScienceCommand;
      if (command.action === 'survey' || command.action === 'explore') {
        if (!command.commandId)
          throw new HttpError(400, 'SCIENCE_COMMAND_ID_REQUIRED', 'Rechargez le client pour préparer une expédition.');
        const receipt = await receiveExpedition(db, account.id, worldSlug, villageId, command as ExpeditionIntent);
        return reply
          .status(receipt.status === 'pending' ? 202 : 200)
          .serializer(reply.compileSerializationSchema(ExpeditionReceiptSchema))
          .send(receipt);
      }
      return villageV2(request, reply, (afterWrites) =>
        commandVillageScience(db, account.id, worldSlug, villageId, command, afterWrites),
      );
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/discover-cat-eyes',
    {
      onRequest: requireProtocolV2,
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        response: { 200: VillageCommandConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      return villageV2(request, reply, (afterWrites) =>
        discoverCatEyes(db, account.id, worldSlug, villageId, afterWrites),
      );
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/buildings',
    {
      onRequest: requireProtocolV2,
      schema: {
        params: VillageParametersSchema,
        body: BuildRequestSchema,
        headers: VillageCommandV2HeadersSchema,
        response: { 201: ConstructionConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as {
        worldSlug: string;
        villageId: string;
      };
      const body = request.body as {
        houseVariant?: 'stone' | 'logs' | 'beams';
        quarterTurns?: number;
        commandId?: string;
        expectedCosts?: Array<{ resourceCode: string; amount: number }>;
        buildingType: string;
        anchorCellX?: number;
        anchorCellY?: number;
        cells?: Array<{ cellX: number; cellY: number }>;
      };
      // Placements always carry their idempotent identity and the spatial form.
      if (!body.commandId || !body.cells || body.anchorCellX === undefined || body.anchorCellY === undefined)
        throw new HttpError(400, 'INVALID_V2_CONSTRUCTION', 'Commande de construction V2 incomplète.');
      await assertSyncV2Available(db);
      const generation = Number(request.headers['x-arbestra-generation'] ?? '0');
      const confirmation = await placeBuildingV2(
        db,
        account.id,
        worldSlug,
        villageId,
        {
          buildingType: body.buildingType as BuildingType,
          anchor: { cellX: body.anchorCellX, cellY: body.anchorCellY },
          cells: body.cells,
          commandId: body.commandId,
          expectedCosts: body.expectedCosts,
          quarterTurns: body.quarterTurns ?? 0,
          houseVariant: body.houseVariant ?? 'stone',
        },
        config.constructionDurationOverrideMs,
        generation,
      );
      observationCommitted(request);
      // Same wire encoding as the V2 stream (see the workshop route).
      return reply.status(201).serializer(JSON.stringify).send(confirmation);
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/expansions',
    {
      onRequest: requireProtocolV2,
      schema: {
        params: BuildingParametersSchema,
        body: ExpansionRequestSchema,
        headers: VillageCommandV2HeadersSchema,
        response: { 201: ConstructionConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId, buildingId } = request.params as {
        worldSlug: string;
        villageId: string;
        buildingId: string;
      };
      const { cells, commandId, expectedCosts } = request.body as {
        cells: Array<{ cellX: number; cellY: number }>;
        commandId?: string;
        expectedCosts?: Array<{ resourceCode: string; amount: number }>;
      };
      if (!commandId) throw new HttpError(400, 'INVALID_V2_CONSTRUCTION', 'Commande de construction V2 incomplète.');
      await assertSyncV2Available(db);
      const confirmation = await expandGardenV2(
        db,
        account.id,
        worldSlug,
        villageId,
        buildingId,
        { cells, commandId, expectedCosts },
        config.constructionDurationOverrideMs,
        Number(request.headers['x-arbestra-generation'] ?? '0'),
      );
      observationCommitted(request);
      return reply.status(201).serializer(JSON.stringify).send(confirmation);
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/upgrade',
    {
      onRequest: requireProtocolV2,
      schema: {
        params: BuildingParametersSchema,
        body: UpgradeRequestSchema,
        headers: VillageCommandV2HeadersSchema,
        response: { 201: ConstructionConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId, buildingId } = request.params as {
        worldSlug: string;
        villageId: string;
        buildingId: string;
      };
      const upgrade = request.body as {
        commandId?: string;
        expectedCosts?: Array<{ resourceCode: string; amount: number }>;
        expectedLevel?: number;
      };
      if (!upgrade.commandId)
        throw new HttpError(400, 'INVALID_V2_CONSTRUCTION', 'Commande de construction V2 incomplète.');
      await assertSyncV2Available(db);
      const confirmation = await upgradeBuildingV2(
        db,
        account.id,
        worldSlug,
        villageId,
        buildingId,
        { commandId: upgrade.commandId, expectedCosts: upgrade.expectedCosts, expectedLevel: upgrade.expectedLevel },
        config.constructionDurationOverrideMs,
        Number(request.headers['x-arbestra-generation'] ?? '0'),
      );
      observationCommitted(request);
      return reply.status(201).serializer(JSON.stringify).send(confirmation);
    },
  );

  app.get(
    '/api/worlds/:worldSlug/villages/:villageId/features/:featureId',
    {
      schema: {
        params: Type.Object({ ...VillageParametersSchema.properties, featureId: Type.String({ format: 'uuid' }) }),
        response: { 200: DepositDetailsSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId, featureId } = request.params as {
        worldSlug: string;
        villageId: string;
        featureId: string;
      };
      return getStoneDepositDetails(db, account.id, worldSlug, villageId, featureId);
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/worksites/:worksiteId',
    {
      onRequest: requireProtocolV2,
      schema: {
        params: Type.Object({ ...VillageParametersSchema.properties, worksiteId: Type.String({ format: 'uuid' }) }),
        headers: VillageCommandV2HeadersSchema,
        body: ChangeExtractionWorksiteRequestSchema,
        response: { 200: VillageCommandConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId, worksiteId } = request.params as {
        worldSlug: string;
        villageId: string;
        worksiteId: string;
      };
      const change = request.body as ChangeExtractionWorksiteRequest;
      return villageV2(
        request,
        reply,
        (afterWrites) => changeVillageWorksite(db, account.id, worldSlug, villageId, worksiteId, change, afterWrites),
        change.commandId,
      );
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/discover-supplies',
    {
      onRequest: requireProtocolV2,
      schema: {
        params: BuildingParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        response: { 200: VillageCommandConfirmationV2Schema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId, buildingId } = request.params as {
        worldSlug: string;
        villageId: string;
        buildingId: string;
      };
      return villageV2(request, reply, (afterWrites) =>
        spatialTransaction(db, (tx) =>
          discoverBuildingSuppliesInTransaction(tx, account.id, worldSlug, villageId, buildingId, afterWrites),
        ),
      );
    },
  );
}
