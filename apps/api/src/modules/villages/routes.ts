import {LevelingRequestSchema, LevelingCommandSchema, LevelingPreviewSchema, type LevelingRequest, type LevelingCommand} from '@arbestra/contracts';
import {previewLeveling, commandLeveling, commandTerraform} from './leveling.js';
import {TerraformCommandSchema,TerraformChangedSchema,type TerraformCommand} from '@arbestra/contracts';
import {observationCommitted} from '../admin/observation-actions.js';
import {receiveExpedition,readExpeditionReceipts} from '../science/expeditions.js';
import {ExpeditionReceiptSchema,type ExpeditionIntent} from '@arbestra/contracts';
import {HarvestIntentSchema,HarvestReceiptSchema,type HarvestIntent} from '@arbestra/contracts';
import {receiveHarvestIntent,readHarvestReceipts} from './harvest-submissions.js';
import { Type } from '@sinclair/typebox';
import { ExtractionPoolCommandSchema, PopulationGestureSchema, HudWorkforceConfirmationSchema, type ExtractionPoolCommand, type PopulationGesture } from '@arbestra/contracts';
import { commandHudWorkforce } from './hud-workforce.js';
import { ScienceCommandSchema, type ScienceCommand } from '@arbestra/contracts';
import { commandVillageScience } from './service.js';
import {InfrastructureRequestSchema,type InfrastructureRequest,InfrastructurePreviewSchema,InfrastructureConfirmationSchema} from '@arbestra/contracts';
import {infrastructureCommand,infrastructurePreview} from './infrastructure.js';
import { ProcessingCommandSchema, ProcessingPreviewSchema, type ProcessingCommand } from '@arbestra/contracts';
import { commandVillageProcessing, previewVillageProcessing } from './service.js';
import { MarketRequestSchema, MarketCommandSchema, MarketPreviewSchema, type MarketRequest, type MarketCommand } from '@arbestra/contracts';
import { commandVillageMarket, previewVillageMarket } from './service.js';
import { TradeCommandSchema, TradePageSchema, TradePreviewSchema, type TradeCommand } from '@arbestra/contracts';
import { commandPlayerMarket, browsePlayerMarket, previewPlayerTrade } from './trade-service.js';
import type { NavigationExecutor } from '../navigation/compute.js';
import {GardenSelectionHarvestRequestSchema,type TravelCell} from '@arbestra/contracts';
import {harvestGardenSelection} from './service.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ConstructionConfirmationSchema, VillageCommandResponseSchema, type VillageState, type VillageSyncBase } from '@arbestra/contracts';
import { readConstructionConfirmation } from './service.js';
import type { ConstructionCommit } from './service.js';
import type { VillageSyncProjections } from './sync-projections.js';
import type {TravelNetworkExecutor} from '../navigation/network-job.js';
import { villageSyncRevision } from './sync-revision.js';
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

const VillageMutationResponseSchema = Type.Union([VillageStateSchema, VillageCommandResponseSchema]);
const VillageSyncHeadersSchema = Type.Object({
  'x-village-sync': Type.Optional(Type.Literal('1')),
  'x-village-revision': Type.Optional(Type.String({ pattern: '^(0|[1-9][0-9]{0,15})$' })),
  'x-village-server-time': Type.Optional(Type.String({ format: 'date-time', maxLength: 48 })),
}, { additionalProperties: true });
const InfrastructureHeadersSchema=Type.Object({...VillageSyncHeadersSchema.properties,'x-infrastructure-confirmation':Type.Optional(Type.Literal('1'))},{additionalProperties:true});
const ConstructionHeadersSchema=Type.Object({...VillageSyncHeadersSchema.properties,'x-construction-confirmation':Type.Optional(Type.Literal('1'))},{additionalProperties:true});
const ConstructionMutationResponseSchema=Type.Union([ConstructionConfirmationSchema,VillageMutationResponseSchema]);
const InfrastructureMutationResponseSchema=Type.Union([InfrastructureConfirmationSchema,VillageCommandResponseSchema,VillageStateSchema]);
function villageReplyOptions(headers: FastifyRequest['headers']) {
  const replyMode = headers['x-village-sync'] === '1' ? 'commit' as const : 'snapshot' as const;
  const revision = headers['x-village-revision'], serverTime = headers['x-village-server-time'];
  let base: VillageSyncBase | undefined;
  if (typeof revision === 'string' && typeof serverTime === 'string') {
    const value = Number(revision);
    if (!Number.isSafeInteger(value)) throw new HttpError(400, 'INVALID_REVISION', 'Révision invalide.');
    base = { revision: value, serverTime };
  }
  return { replyMode, base };
}

export async function registerVillageRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  config: AppConfig,
  projections: VillageSyncProjections,
  navigation: TravelNetworkExecutor,
): Promise<void> {
  const hudResponse=HudWorkforceConfirmationSchema;
  app.post('/api/worlds/:worldSlug/villages/:villageId/extraction-pools',{
    schema:{params:VillageParametersSchema,body:ExtractionPoolCommandSchema,response:{200:hudResponse}},
  },async request=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    const result=await commandHudWorkforce(db,account.id,worldSlug,villageId,{kind:'pool',command:request.body as ExtractionPoolCommand});
    observationCommitted(request);return result;
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/population/gestures',{
    schema:{params:VillageParametersSchema,body:PopulationGestureSchema,response:{200:hudResponse}},
  },async request=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    const result=await commandHudWorkforce(db,account.id,worldSlug,villageId,{kind:'population',command:request.body as PopulationGesture});
    observationCommitted(request);return result;
  });
  const commandResponse = async (reply: FastifyReply, accountId: string, worldSlug: string,
    result: VillageState | ConstructionCommit, base: VillageSyncBase | undefined) => {
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
  const constructionResponse = async (request: FastifyRequest, reply: FastifyReply, accountId: string, worldSlug: string,
    result: VillageState | ConstructionCommit, base: VillageSyncBase | undefined) => {
    if (!('cells' in result) && result.commandId && request.headers['x-construction-confirmation'] === '1') {
      const confirmed = await readConstructionConfirmation(db, accountId, worldSlug, result);
      reply.serializer(reply.compileSerializationSchema(ConstructionConfirmationSchema, '201'));
      return confirmed;
    }
    return commandResponse(reply, accountId, worldSlug, result, base);
  };
  app.post('/api/worlds/:worldSlug/villages/:villageId/leveling/preview', {
    schema: { params: VillageParametersSchema, body: LevelingRequestSchema, response: {200: LevelingPreviewSchema} },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const {worldSlug,villageId} = request.params as {worldSlug:string;villageId:string};
    return previewLeveling(db, account.id, worldSlug, villageId, request.body as LevelingRequest);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/terraform', {
    schema:{params:VillageParametersSchema,body:TerraformCommandSchema,response:{200:Type.Union([
      TerraformChangedSchema,Type.Object({status:Type.Literal('started'),state:VillageStateSchema}),
    ])}},
  },async request=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    return commandTerraform(db,account.id,worldSlug,villageId,request.body as TerraformCommand);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/leveling', {
    schema: { params: VillageParametersSchema, body: LevelingCommandSchema, response: {200: VillageStateSchema} },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const {worldSlug,villageId} = request.params as {worldSlug:string;villageId:string};
    return commandLeveling(db, account.id, worldSlug, villageId, request.body as LevelingCommand);
  });
  const tradeNavigation = navigation as TravelNetworkExecutor & NavigationExecutor;
  app.get('/api/worlds/:worldSlug/villages/:villageId/market/offers', {
    schema: { params: VillageParametersSchema, querystring: Type.Object({ mine: Type.Optional(Type.Boolean()), cursor: Type.Optional(Type.String({ format: 'uuid' })) }), response: { 200: TradePageSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    const { mine, cursor } = request.query as { mine?: boolean; cursor?: string };
    return browsePlayerMarket(db, account.id, worldSlug, villageId, !!mine, cursor);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/market/trade-preview', {
    schema: { params: VillageParametersSchema, body: Type.Object({ offerId: Type.String({ format: 'uuid' }) }, { additionalProperties: false }), response: { 200: TradePreviewSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return previewPlayerTrade(db, account.id, worldSlug, villageId, (request.body as { offerId: string }).offerId, tradeNavigation);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/market/trades', {
    schema: { params: VillageParametersSchema, body: TradeCommandSchema, response: { 200: VillageStateSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return commandPlayerMarket(db, account.id, worldSlug, villageId, request.body as TradeCommand, tradeNavigation);
  });
  app.get('/api/worlds/:worldSlug/villages/:villageId/harvest-intents',{
    schema:{params:VillageParametersSchema,querystring:Type.Object({ids:Type.String({maxLength:2400})}),response:{200:Type.Array(HarvestReceiptSchema)}},
  },async request=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    return readHarvestReceipts(db,account.id,worldSlug,villageId,(request.query as {ids:string}).ids.split(','));
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/harvest-intents', {
    schema:{params:VillageParametersSchema,body:HarvestIntentSchema,response:{200:HarvestReceiptSchema}},
  },async request=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);
    const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    return receiveHarvestIntent(db,account.id,worldSlug,villageId,request.body as HarvestIntent);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/market/preview', {
    schema: { params: VillageParametersSchema, body: MarketRequestSchema, response: { 200: MarketPreviewSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return previewVillageMarket(db, account.id, worldSlug, villageId, request.body as MarketRequest);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/market', {
    schema: { params: VillageParametersSchema, headers: VillageSyncHeadersSchema, body: MarketCommandSchema, response: { 200: VillageMutationResponseSchema } },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    const options = villageReplyOptions(request.headers);
    const result = await commandVillageMarket(db, account.id, worldSlug, villageId, request.body as MarketCommand, options.replyMode);
    observationCommitted(request);
    return commandResponse(reply, account.id, worldSlug, result, options.base);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/processing', {
    schema: { params: VillageParametersSchema, headers: VillageSyncHeadersSchema, body: ProcessingCommandSchema, response: { 200: VillageMutationResponseSchema } },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    const options = villageReplyOptions(request.headers);
    const result = await commandVillageProcessing(db, account.id, worldSlug, villageId, request.body as ProcessingCommand, options.replyMode);
    observationCommitted(request);
    return commandResponse(reply, account.id, worldSlug, result, options.base);
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
    schema:{params:VillageParametersSchema,body:InfrastructureRequestSchema,...(!preview?{headers:InfrastructureHeadersSchema}:{}),response:{200:preview?InfrastructurePreviewSchema:InfrastructureMutationResponseSchema}},
  },async (request,reply)=>{const account=await authenticate(db,request.cookies[config.cookieName]);const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};
    if(preview)return infrastructurePreview(db,account.id,worldSlug,villageId,request.body as InfrastructureRequest);
    const options=villageReplyOptions(request.headers),started=performance.now();
    const result=await infrastructureCommand(db,account.id,worldSlug,villageId,request.body as InfrastructureRequest,request.headers['x-infrastructure-confirmation']==='1'?'confirmation':options.replyMode);
    observationCommitted(request);
    const committed=performance.now(),response='kind' in result?result:await commandResponse(reply,account.id,worldSlug,result,options.base);
    reply.header('server-timing',`road_tx;dur=${(committed-started).toFixed(1)}, road_sync;dur=${(performance.now()-committed).toFixed(1)}`);
    // Keep the first compact reply independent of the complete-village union's lazy validator.
    if('kind' in response&&response.kind==='infrastructure-confirmation')reply.serializer(reply.compileSerializationSchema(InfrastructureConfirmationSchema,'200'));
    return response;});
  for (const preview of [true, false]) app.post(`/api/worlds/:worldSlug/villages/:villageId/exploitation${preview ? '/preview' : ''}`, {
    schema: { params: VillageParametersSchema, body: ExploitationRequestSchema, response: { 200: preview ? ExploitationPreviewSchema : VillageStateSchema } },
  }, async request => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    return (preview ? previewVillageExploitation : startVillageExploitation)(db, account.id, worldSlug, villageId, request.body as ExploitationRequest);
  });
  app.post('/api/worlds/:worldSlug/villages/:villageId/science', {
    schema: { params: VillageParametersSchema, headers: VillageSyncHeadersSchema, body: ScienceCommandSchema, response: { 200: Type.Union([VillageMutationResponseSchema,ExpeditionReceiptSchema]),202:ExpeditionReceiptSchema } },
  }, async (request,reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug, villageId } = request.params as { worldSlug: string; villageId: string };
    const command=request.body as ScienceCommand;
    if(command.action==='survey'||command.action==='explore'){
      if(!command.commandId)throw new HttpError(400,'SCIENCE_COMMAND_ID_REQUIRED','Rechargez le client pour préparer une expédition.');
      const receipt=await receiveExpedition(db,account.id,worldSlug,villageId,command as ExpeditionIntent);
      return reply.status(receipt.status==='pending'?202:200).serializer(reply.compileSerializationSchema(ExpeditionReceiptSchema)).send(receipt);
    }
    const options = villageReplyOptions(request.headers);
    const result = await commandVillageScience(db, account.id, worldSlug, villageId, command, options.replyMode);
    observationCommitted(request);
    return commandResponse(reply, account.id, worldSlug, result, options.base);
  });
  app.get('/api/worlds/:worldSlug/villages/:villageId/science/expeditions',{schema:{params:VillageParametersSchema,querystring:Type.Object({ids:Type.Optional(Type.String({maxLength:2400})),before:Type.Optional(Type.String({format:'uuid'}))}),response:{200:Type.Array(ExpeditionReceiptSchema)}}},async (request,reply)=>{
    const account=await authenticate(db,request.cookies[config.cookieName]);const {worldSlug,villageId}=request.params as {worldSlug:string;villageId:string};const {ids,before}=request.query as {ids?:string;before?:string};
    const receipts=await readExpeditionReceipts(db,account.id,worldSlug,villageId,ids?.split(','),before);
    const history=receipts.filter(r=>r.status!=='pending');if(!ids&&history.length===64)reply.header('x-expedition-next-before',history.at(-1)!.commandId);
    return receipts;
  });
  app.get('/api/worlds/:worldSlug/village', {
    schema: { params: WorldParametersSchema, querystring: Type.Object({ villageId: Type.Optional(Type.String({ format: 'uuid' })) }), response: { 200: VillageStateSchema } },
  }, async (request) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const { worldSlug } = request.params as { worldSlug: string };
    return getVillageState(db, account.id, worldSlug, (request.query as { villageId?: string }).villageId,navigation);
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
      headers: ConstructionHeadersSchema, response: { 201: ConstructionMutationResponseSchema },
    },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const options = villageReplyOptions(request.headers);
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
      body.quarterTurns, body.houseVariant, options.replyMode,
    ) : await constructBuilding(db, account.id, worldSlug, villageId, body.cellX!, body.cellY!, body.buildingType, config.constructionDurationOverrideMs, body.commandId, body.expectedCosts,body.quarterTurns,body.houseVariant,options.replyMode);
    observationCommitted(request);
    return reply.status(201).send(await constructionResponse(request, reply, account.id, worldSlug, state, options.base));
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/expansions', {
    schema: { params: BuildingParametersSchema, body: ExpansionRequestSchema, headers: ConstructionHeadersSchema, response: { 201: ConstructionMutationResponseSchema } },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const options = villageReplyOptions(request.headers);
    const { worldSlug, villageId, buildingId } = request.params as { worldSlug: string; villageId: string; buildingId: string };
    const { cells, commandId, expectedCosts } = request.body as { cells: Array<{ cellX: number; cellY: number }>; commandId?: string; expectedCosts?: Array<{ resourceCode: string; amount: number }> };
    const state = await expandGarden(db, account.id, worldSlug, villageId, buildingId, cells, config.constructionDurationOverrideMs, commandId, expectedCosts, options.replyMode);
    observationCommitted(request);
    return reply.status(201).send(await constructionResponse(request, reply, account.id, worldSlug, state, options.base));
  });

  app.post('/api/worlds/:worldSlug/villages/:villageId/buildings/:buildingId/upgrade', {
    schema: {
      params: BuildingParametersSchema,
      body: UpgradeRequestSchema,
      headers: ConstructionHeadersSchema, response: { 201: ConstructionMutationResponseSchema },
    },
  }, async (request, reply) => {
    const account = await authenticate(db, request.cookies[config.cookieName]);
    const options = villageReplyOptions(request.headers);
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
      (request.body as { expectedLevel?: number }).expectedLevel, options.replyMode,
    );
    observationCommitted(request);
    return reply.status(201).send(await constructionResponse(request, reply, account.id, worldSlug, state, options.base));
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
