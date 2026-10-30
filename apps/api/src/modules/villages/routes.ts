import {
  LevelingRequestSchema,
  LevelingCommandSchema,
  LevelingPreviewSchema,
  type LevelingRequest,
  type LevelingCommand,
} from '@arbestra/contracts';
import { previewLeveling, commandLeveling, commandTerraform } from './leveling.js';
import { TerraformCommandSchema, TerraformChangedSchema, type TerraformCommand } from '@arbestra/contracts';
import { observationCommitted } from '../admin/observation-actions.js';
import {
  RoadCellsConfirmationV2Schema,
  RoadCellsPreviewRequestSchema,
  RoadCellsPreviewSchema,
  RoadCellsRequestSchema,
  type RoadCellsPreviewRequest,
  type RoadCellsRequest,
} from '@arbestra/contracts';
import { previewRoadCells, roadCellsCommandV2 } from './road-cells.js';
import { receiveExpedition, readExpeditionReceipts } from '../science/expeditions.js';
import { ExpeditionReceiptSchema, type ExpeditionIntent } from '@arbestra/contracts';
import {
  HarvestCancelReceiptSchema,
  HarvestIntentSchema,
  HarvestReceiptSchema,
  type HarvestIntent,
} from '@arbestra/contracts';
import { receiveHarvestIntent, readHarvestReceipts } from './harvest-submissions.js';
import { cancelHarvestIntent } from './harvest-cancellations.js';
import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import {
  ExtractionPoolCommandSchema,
  PopulationGestureSchema,
  HudWorkforceConfirmationSchema,
  type ExtractionPoolCommand,
  type PopulationGesture,
} from '@arbestra/contracts';
import { commandHudWorkforce } from './hud-workforce.js';
import { ScienceCommandSchema, type ScienceCommand } from '@arbestra/contracts';
import { commandVillageScience } from './service.js';
import {
  InfrastructureRequestSchema,
  type InfrastructureRequest,
  InfrastructurePreviewSchema,
  InfrastructureConfirmationSchema,
} from '@arbestra/contracts';
import { infrastructureCommand, infrastructurePreview } from './infrastructure.js';
import { ProcessingCommandSchema, ProcessingPreviewSchema, type ProcessingCommand } from '@arbestra/contracts';
import { commandVillageProcessing, previewVillageProcessing } from './service.js';
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
import {
  ConstructionConfirmationSchema,
  VillageCommandResponseSchema,
  type VillageState,
  type VillageSyncBase,
} from '@arbestra/contracts';
import { readConstructionConfirmation } from './service.js';
import type { AfterConstructionWrites, ConstructionCommit } from './service.js';
import { discoverBuildingSuppliesInTransaction } from './service.js';
import { VillageCommandConfirmationV2Schema } from '@arbestra/contracts';
import { villageCommandV2 } from './command-v2.js';
import type { VillageSyncProjections } from './sync-projections.js';
import type { TravelNetworkExecutor } from '../navigation/network-job.js';
import { villageSyncRevision } from './sync-revision.js';
import type { Kysely } from 'kysely';

import {
  CatDiscoveryResponseSchema,
  BuildRequestSchema,
  DepositDetailsSchema,
  ExpansionRequestSchema,
  ExtractionWorksiteResponseSchema,
  ChangeExtractionWorksiteRequestSchema,
  UpgradeRequestSchema,
  VillageStateSchema,
} from '@arbestra/contracts';
import type { ChangeExtractionWorksiteRequest } from '@arbestra/contracts';
import { ExploitationRequestSchema, ExploitationPreviewSchema, type ExploitationRequest } from '@arbestra/contracts';
import { previewVillageExploitation, startVillageExploitation } from './service.js';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../database/schema.js';
import { HttpError } from '../../errors.js';
import { authenticate } from '../auth/service.js';
import { callerFrames } from '../operations/http-logging.js';
import {
  discoverCatEyes,
  constructBuilding,
  constructBuildingArea,
  discoverBuildingSupplies,
  expandGarden,
  getStoneDepositDetails,
  getVillageState,
  changeVillageWorksite,
  upgradeBuilding,
} from './service.js';

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

const VillageMutationResponseSchema = Type.Union([VillageStateSchema, VillageCommandResponseSchema]);
const VillageSyncHeadersSchema = Type.Object(
  {
    'x-village-sync': Type.Optional(Type.Literal('1')),
    'x-village-revision': Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,15})$' })),
    'x-village-server-time': Type.Optional(Type.String({ format: 'date-time', maxLength: 48 })),
  },
  { additionalProperties: true },
);
const ProcessingHeadersSchema = Type.Object(
  {
    ...VillageSyncHeadersSchema.properties,
    'x-arbestra-protocol': Type.Optional(Type.Literal('2')),
    'x-arbestra-generation': Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,15})$' })),
  },
  { additionalProperties: true },
);
/** V2 gestures without a body identifier carry the client's UUID in a header. */
const VillageCommandV2HeadersSchema = Type.Object(
  {
    ...VillageSyncHeadersSchema.properties,
    'x-arbestra-protocol': Type.Optional(Type.Literal('2')),
    'x-arbestra-generation': Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,15})$' })),
    'x-arbestra-command': Type.Optional(Type.String({ format: 'uuid' })),
  },
  { additionalProperties: true },
);
const InfrastructureHeadersSchema = Type.Object(
  { ...VillageSyncHeadersSchema.properties, 'x-infrastructure-confirmation': Type.Optional(Type.Literal('1')) },
  { additionalProperties: true },
);
const ConstructionHeadersSchema = Type.Object(
  {
    ...VillageSyncHeadersSchema.properties,
    'x-construction-confirmation': Type.Optional(Type.Literal('1')),
    'x-arbestra-protocol': Type.Optional(Type.Literal('2')),
    'x-arbestra-generation': Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,15})$' })),
  },
  { additionalProperties: true },
);
const ConstructionMutationResponseSchema = Type.Union([ConstructionConfirmationSchema, VillageMutationResponseSchema]);
const InfrastructureMutationResponseSchema = Type.Union([
  InfrastructureConfirmationSchema,
  VillageCommandResponseSchema,
  VillageStateSchema,
]);
function villageReplyOptions(headers: FastifyRequest['headers']) {
  const replyMode = headers['x-village-sync'] === '1' ? ('commit' as const) : ('snapshot' as const);
  const revision = headers['x-village-revision'],
    serverTime = headers['x-village-server-time'];
  let base: VillageSyncBase | undefined;
  if (typeof revision === 'string' && typeof serverTime === 'string') {
    const value = Number(revision);
    if (!Number.isSafeInteger(value)) throw new HttpError(400, 'INVALID_REVISION', 'Révision invalide.');
    base = { revision: value, serverTime };
  }
  return { replyMode, base };
}

/** Internal signal: a terraform quote changed, nothing was committed. */
class TerraformQuoteChanged extends Error {}

export async function registerVillageRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: AppConfig,
  projections: VillageSyncProjections,
  navigation: TravelNetworkExecutor,
): Promise<void> {
  const hudResponse = HudWorkforceConfirmationSchema;
  /** Answers a gesture on the V2 contract when the client asked for it. */
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
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/extraction-pools',
    {
      schema: { params: VillageParametersSchema, body: ExtractionPoolCommandSchema, response: { 200: hudResponse } },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const result = await commandHudWorkforce(db, account.id, worldSlug, villageId, {
        kind: 'pool',
        command: request.body as ExtractionPoolCommand,
      });
      observationCommitted(request);
      return result;
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/population/gestures',
    {
      schema: { params: VillageParametersSchema, body: PopulationGestureSchema, response: { 200: hudResponse } },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const result = await commandHudWorkforce(db, account.id, worldSlug, villageId, {
        kind: 'population',
        command: request.body as PopulationGesture,
      });
      observationCommitted(request);
      return result;
    },
  );
  const commandResponse = async (
    reply: FastifyReply,
    accountId: string,
    worldSlug: string,
    result: VillageState | ConstructionCommit,
    base: VillageSyncBase | undefined,
  ) => {
    if ('cells' in result) {
      reply.serializer(reply.compileSerializationSchema(VillageStateSchema));
      return result;
    }
    // Read after COMMIT: reject shared projections started before this command.
    const minimum = (await villageSyncRevision(db, result.worldId)).revision;
    const response = await projections.commandResponse(accountId, worldSlug, result, base, minimum);
    // The server already selected the envelope. Compiling the whole nested union
    // makes its lazy validators recompile the village on the first action.
    const schema = VillageCommandResponseSchema.anyOf[response.kind === 'frame' ? 0 : 1];
    reply.serializer(reply.compileSerializationSchema(schema));
    return response;
  };
  const constructionResponse = async (
    request: FastifyRequest,
    reply: FastifyReply,
    accountId: string,
    worldSlug: string,
    result: VillageState | ConstructionCommit,
    base: VillageSyncBase | undefined,
  ) => {
    if (!('cells' in result) && result.commandId && request.headers['x-construction-confirmation'] === '1') {
      const confirmed = await readConstructionConfirmation(db, accountId, worldSlug, result);
      reply.serializer(reply.compileSerializationSchema(ConstructionConfirmationSchema, '201'));
      return confirmed;
    }
    return commandResponse(reply, accountId, worldSlug, result, base);
  };
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/leveling/preview',
    {
      schema: {
        params: VillageParametersSchema,
        body: LevelingRequestSchema,
        response: { 200: LevelingPreviewSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      return previewLeveling(db, account.id, worldSlug, villageId, request.body as LevelingRequest);
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/terraform',
    {
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: TerraformCommandSchema,
        response: {
          200: Type.Union([
            TerraformChangedSchema,
            Type.Object({ status: Type.Literal('started'), state: VillageStateSchema }),
            VillageCommandConfirmationV2Schema,
          ]),
        },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const command = request.body as TerraformCommand;
      if (request.headers['x-arbestra-protocol'] === '2') {
        // An adjusted quote rolled back without effects keeps its compact answer.
        let changed: unknown;
        const sent = await villageV2(
          request,
          reply,
          async (afterWrites) => {
            const result = await commandTerraform(db, account.id, worldSlug, villageId, command, afterWrites);
            if (result.status === 'changed') {
              changed = result;
              throw new TerraformQuoteChanged();
            }
            return result.state;
          },
          command.commandId,
        ).catch((error) => {
          if (error instanceof TerraformQuoteChanged) return undefined;
          throw error;
        });
        return sent ?? reply.serializer(JSON.stringify).send(changed);
      }
      return commandTerraform(db, account.id, worldSlug, villageId, command);
    },
  );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/leveling',
    {
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: LevelingCommandSchema,
        response: { 200: Type.Union([VillageStateSchema, VillageCommandConfirmationV2Schema]) },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const command = request.body as LevelingCommand;
      if (request.headers['x-arbestra-protocol'] === '2')
        return villageV2(
          request,
          reply,
          (afterWrites) => commandLeveling(db, account.id, worldSlug, villageId, command, afterWrites),
          command.commandId,
        );
      return commandLeveling(db, account.id, worldSlug, villageId, command);
    },
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
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: TradeCommandSchema,
        response: { 200: Type.Union([VillageStateSchema, VillageCommandConfirmationV2Schema]) },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const command = request.body as TradeCommand;
      if (request.headers['x-arbestra-protocol'] === '2')
        return villageV2(
          request,
          reply,
          (afterWrites) =>
            commandPlayerMarket(db, account.id, worldSlug, villageId, command, tradeNavigation, afterWrites),
          command.commandId,
        );
      return commandPlayerMarket(db, account.id, worldSlug, villageId, command, tradeNavigation);
    },
  );
  app.get(
    '/api/worlds/:worldSlug/villages/:villageId/harvest-intents',
    {
      schema: {
        params: VillageParametersSchema,
        querystring: Type.Object({ ids: Type.String({ maxLength: 2400 }) }),
        response: { 200: Type.Array(HarvestReceiptSchema) },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      return readHarvestReceipts(
        db,
        account.id,
        worldSlug,
        villageId,
        (request.query as { ids: string }).ids.split(','),
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
      schema: {
        params: VillageParametersSchema,
        headers: ProcessingHeadersSchema,
        body: ProcessingCommandSchema,
        response: { 200: Type.Union([ProcessingConfirmationV2Schema, VillageMutationResponseSchema]) },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      if (request.headers['x-arbestra-protocol'] === '2') {
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
      }
      const options = villageReplyOptions(request.headers);
      const result = await commandVillageProcessing(
        db,
        account.id,
        worldSlug,
        villageId,
        request.body as ProcessingCommand,
        options.replyMode,
      );
      observationCommitted(request);
      return commandResponse(reply, account.id, worldSlug, result, options.base);
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
  for (const preview of [true, false])
    app.post(
      `/api/worlds/:worldSlug/villages/:villageId/infrastructure${preview ? '/preview' : ''}`,
      {
        schema: {
          params: VillageParametersSchema,
          body: InfrastructureRequestSchema,
          ...(!preview ? { headers: InfrastructureHeadersSchema } : {}),
          response: { 200: preview ? InfrastructurePreviewSchema : InfrastructureMutationResponseSchema },
        },
      },
      async (request, reply) => {
        const account = await authenticate(db, request.cookies[config.cookieName]);
        const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
        if (preview)
          return infrastructurePreview(db, account.id, worldSlug, villageId, request.body as InfrastructureRequest);
        const options = villageReplyOptions(request.headers),
          started = performance.now();
        const result = await infrastructureCommand(
          db,
          account.id,
          worldSlug,
          villageId,
          request.body as InfrastructureRequest,
          request.headers['x-infrastructure-confirmation'] === '1' ? 'confirmation' : options.replyMode,
        );
        observationCommitted(request);
        const committed = performance.now(),
          response =
            'kind' in result ? result : await commandResponse(reply, account.id, worldSlug, result, options.base);
        reply.header(
          'server-timing',
          `road_tx;dur=${(committed - started).toFixed(1)}, road_sync;dur=${(performance.now() - committed).toFixed(1)}`,
        );
        // Keep the first compact reply independent of the complete-village union's lazy validator.
        if ('kind' in response && response.kind === 'infrastructure-confirmation')
          reply.serializer(reply.compileSerializationSchema(InfrastructureConfirmationSchema, '200'));
        return response;
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
  for (const preview of [true, false])
    app.post(
      `/api/worlds/:worldSlug/villages/:villageId/exploitation${preview ? '/preview' : ''}`,
      {
        schema: {
          params: VillageParametersSchema,
          headers: VillageCommandV2HeadersSchema,
          body: ExploitationRequestSchema,
          response: {
            200: preview
              ? ExploitationPreviewSchema
              : Type.Union([VillageStateSchema, VillageCommandConfirmationV2Schema]),
          },
        },
      },
      async (request, reply) => {
        const account = await authenticate(db, request.cookies[config.cookieName]);
        const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
        const order = request.body as ExploitationRequest;
        if (!preview && request.headers['x-arbestra-protocol'] === '2') {
          // The order's own UUID identifies the gesture.
          return villageV2(
            request,
            reply,
            (afterWrites) => startVillageExploitation(db, account.id, worldSlug, villageId, order, afterWrites),
            order.commandId,
          );
        }
        return (preview ? previewVillageExploitation : startVillageExploitation)(
          db,
          account.id,
          worldSlug,
          villageId,
          request.body as ExploitationRequest,
        );
      },
    );
  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/science',
    {
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        body: ScienceCommandSchema,
        response: {
          200: Type.Union([VillageMutationResponseSchema, ExpeditionReceiptSchema, VillageCommandConfirmationV2Schema]),
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
      if (request.headers['x-arbestra-protocol'] === '2')
        return villageV2(request, reply, (afterWrites) =>
          commandVillageScience(db, account.id, worldSlug, villageId, command, 'commit', afterWrites),
        );
      const options = villageReplyOptions(request.headers);
      const result = await commandVillageScience(db, account.id, worldSlug, villageId, command, options.replyMode);
      observationCommitted(request);
      return commandResponse(reply, account.id, worldSlug, result, options.base);
    },
  );
  app.get(
    '/api/worlds/:worldSlug/villages/:villageId/science/expeditions',
    {
      schema: {
        params: VillageParametersSchema,
        querystring: Type.Object({
          ids: Type.Optional(Type.String({ maxLength: 2400 })),
          before: Type.Optional(Type.String({ format: 'uuid' })),
        }),
        response: { 200: Type.Array(ExpeditionReceiptSchema) },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      const { ids, before } = request.query as { ids?: string; before?: string };
      const receipts = await readExpeditionReceipts(db, account.id, worldSlug, villageId, ids?.split(','), before);
      const history = receipts.filter((r) => r.status !== 'pending');
      if (!ids && history.length === 64) reply.header('x-expedition-next-before', history.at(-1)!.commandId);
      return receipts;
    },
  );
  app.get(
    '/api/worlds/:worldSlug/village',
    {
      schema: {
        params: WorldParametersSchema,
        querystring: Type.Object({ villageId: Type.Optional(Type.String({ format: 'uuid' })) }),
        response: { 200: VillageStateSchema },
      },
    },
    async (request) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug } = request.params as { worldSlug: string };
      const caller = request.headers['x-arbestra-caller'];
      if (typeof caller === 'string')
        request.log.warn(
          { code: 'LEGACY_VILLAGE_READ', frames: callerFrames(caller.split(' ')) },
          'Legacy village read under V2',
        );
      return getVillageState(
        db,
        account.id,
        worldSlug,
        (request.query as { villageId?: string }).villageId,
        navigation,
      );
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/discover-cat-eyes',
    {
      schema: {
        params: VillageParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        response: { 200: Type.Union([CatDiscoveryResponseSchema, VillageCommandConfirmationV2Schema]) },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
      if (request.headers['x-arbestra-protocol'] === '2')
        return villageV2(request, reply, (afterWrites) =>
          discoverCatEyes(db, account.id, worldSlug, villageId, afterWrites),
        );
      return discoverCatEyes(db, account.id, worldSlug, villageId);
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/buildings',
    {
      schema: {
        params: VillageParametersSchema,
        body: BuildRequestSchema,
        headers: ConstructionHeadersSchema,
        response: { 201: ConstructionMutationResponseSchema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const options = villageReplyOptions(request.headers);
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
        cellX?: number;
        cellY?: number;
      };
      if (request.headers['x-arbestra-protocol'] === '2') {
        // V2 mutations always carry their idempotent identity and the spatial form.
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
      }
      const state = body.cells
        ? await constructBuildingArea(
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
            body.quarterTurns,
            body.houseVariant,
            options.replyMode,
          )
        : await constructBuilding(
            db,
            account.id,
            worldSlug,
            villageId,
            body.cellX!,
            body.cellY!,
            body.buildingType,
            config.constructionDurationOverrideMs,
            body.commandId,
            body.expectedCosts,
            body.quarterTurns,
            body.houseVariant,
            options.replyMode,
          );
      observationCommitted(request);
      return reply
        .status(201)
        .send(await constructionResponse(request, reply, account.id, worldSlug, state, options.base));
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/expansions',
    {
      schema: {
        params: BuildingParametersSchema,
        body: ExpansionRequestSchema,
        headers: ConstructionHeadersSchema,
        response: { 201: ConstructionMutationResponseSchema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const options = villageReplyOptions(request.headers);
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
      if (request.headers['x-arbestra-protocol'] === '2') {
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
      }
      const state = await expandGarden(
        db,
        account.id,
        worldSlug,
        villageId,
        buildingId,
        cells,
        config.constructionDurationOverrideMs,
        commandId,
        expectedCosts,
        options.replyMode,
      );
      observationCommitted(request);
      return reply
        .status(201)
        .send(await constructionResponse(request, reply, account.id, worldSlug, state, options.base));
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/upgrade',
    {
      schema: {
        params: BuildingParametersSchema,
        body: UpgradeRequestSchema,
        headers: ConstructionHeadersSchema,
        response: { 201: ConstructionMutationResponseSchema },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const options = villageReplyOptions(request.headers);
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
      if (request.headers['x-arbestra-protocol'] === '2') {
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
      }
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
        options.replyMode,
      );
      observationCommitted(request);
      return reply
        .status(201)
        .send(await constructionResponse(request, reply, account.id, worldSlug, state, options.base));
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
      schema: {
        params: Type.Object({ ...VillageParametersSchema.properties, worksiteId: Type.String({ format: 'uuid' }) }),
        headers: VillageCommandV2HeadersSchema,
        body: ChangeExtractionWorksiteRequestSchema,
        response: { 200: Type.Union([ExtractionWorksiteResponseSchema, VillageCommandConfirmationV2Schema]) },
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
      if (request.headers['x-arbestra-protocol'] === '2')
        return villageV2(
          request,
          reply,
          (afterWrites) => changeVillageWorksite(db, account.id, worldSlug, villageId, worksiteId, change, afterWrites),
          change.commandId,
        );
      return changeVillageWorksite(
        db,
        account.id,
        worldSlug,
        villageId,
        worksiteId,
        request.body as ChangeExtractionWorksiteRequest,
      );
    },
  );

  app.post(
    '/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/discover-supplies',
    {
      schema: {
        params: BuildingParametersSchema,
        headers: VillageCommandV2HeadersSchema,
        response: { 200: Type.Union([VillageStateSchema, VillageCommandConfirmationV2Schema]) },
      },
    },
    async (request, reply) => {
      const account = await authenticate(db, request.cookies[config.cookieName]);
      const { worldSlug, villageId, buildingId } = request.params as {
        worldSlug: string;
        villageId: string;
        buildingId: string;
      };
      if (request.headers['x-arbestra-protocol'] === '2')
        return villageV2(request, reply, (afterWrites) =>
          db
            .transaction()
            .execute((tx) =>
              discoverBuildingSuppliesInTransaction(tx, account.id, worldSlug, villageId, buildingId, afterWrites),
            ),
        );
      return discoverBuildingSupplies(db, account.id, worldSlug, villageId, buildingId);
    },
  );
}
