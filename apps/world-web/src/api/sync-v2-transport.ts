import {processingCommandIsValid,processingConfirmationV2IsValid,syncV2BatchIsValid,commandReceiptReadResponseIsValid,villagePresentationIsValid,
  constructionConfirmationV2IsValid,type ConstructionConfirmationV2,type VillagePresentation,type ProcessingCommand,type ProcessingConfirmationV2,type SyncV2Batch,type SyncV2State,type SyncV2ReadRequest} from '@arbestra/contracts';
import {SyncV2Session,SyncV2ResyncRequired,SyncV2SessionExpired} from './sync-v2-session';

let nextGeneration=0;
export class SyncV2HttpError extends Error{
  constructor(readonly status:number,readonly code:string,message:string,readonly retryAfterMs=1000){super(message);}
}
type Options={publish:(state:SyncV2State,observedAt:string,batch:SyncV2Batch)=>void;expired:()=>void;
  request?:typeof fetch;storage?:Storage;scopes?:SyncV2ReadRequest['scopes'];
  /** Shared scopes keyed by the server; the private stream is implicit. */
  include?:readonly ('knowledge'|'manifest'|'traffic')[]};

async function parse(response:Response):Promise<unknown>{
  const data:unknown=await response.json();
  if(response.status===401)throw new SyncV2SessionExpired();
  if(!response.ok){const error=data as {code?:string;message?:string};
    const seconds=Number(response.headers.get('retry-after')??'1');
    throw new SyncV2HttpError(response.status,error.code??'HTTP_ERROR',error.message??'Synchronisation indisponible.',
      Number.isFinite(seconds)?Math.max(0,Math.min(seconds,60))*1000:1000);}
  return data;
}
const includeQuery=(options:Options)=>options.include?.length?`&include=${options.include.join(',')}`:'';

/** One mounted village owns this transport. Only intentions are persisted:
 * every reload reacquires complete projection values with their cursors. */
export class SyncV2Transport{
  /** First load without the historical village read: the server resolves
   * the default village, whose id then comes from the snapshot itself. */
  static async bootstrapWorld(worldSlug:string,options:Options):Promise<SyncV2Transport>{
    const generation=++nextGeneration,request=options.request??((input,init)=>fetch(input,init));
    const input=await parse(await request(`/api/worlds/${encodeURIComponent(worldSlug)}/village/bootstrap?generation=${generation}${includeQuery(options)}`,
      {credentials:'same-origin',headers:{'x-arbestra-protocol':'2','x-arbestra-generation':String(generation)}}));
    if(!syncV2BatchIsValid(input)||input.coverage!=='scope-snapshot'||input.generation!==generation)throw new SyncV2ResyncRequired();
    const transport=new SyncV2Transport(worldSlug,input.worldId,input.villageId,options,generation);
    transport.open(input);
    return transport;
  }
  readonly generation:number;
  private session:SyncV2Session|null=null;
  private closed=false;
  private readonly controller=new AbortController();
  private retry:ReturnType<typeof setTimeout>|undefined;
  private refreshFlight:Promise<void>|null=null;
  private pendingKey:string|null=null;
  private readonly request:typeof fetch;
  private readonly storage:Storage|undefined;
  private readonly root:string;
  constructor(private readonly worldSlug:string,readonly worldId:string,readonly villageId:string,private options:Options,generation?:number){
    this.generation=generation??++nextGeneration;
    // Never store the global fetch as a method: browsers reject that receiver.
    this.request=options.request??((input,init)=>fetch(input,init));this.storage=options.storage??globalThis.sessionStorage;
    this.root=`/api/worlds/${encodeURIComponent(worldSlug)}/villages/${encodeURIComponent(villageId)}`;
  }
  get snapshot(){return this.session?.snapshot;}
  private async json(path:string,init:RequestInit={}):Promise<unknown>{
    return parse(await this.request(this.root+path,{credentials:'same-origin',...init,signal:this.controller.signal,
      headers:{'content-type':'application/json','x-arbestra-protocol':'2','x-arbestra-generation':String(this.generation),...init.headers}}));
  }
  /** A new owner (the mounted village) takes over an already open session. */
  rebind(handlers:Pick<Options,'publish'|'expired'>){this.options={...this.options,...handlers};}
  async start(alreadyWoken=false):Promise<void>{
    const input=await this.json(alreadyWoken?'/sync/read':`/bootstrap?generation=${this.generation}${includeQuery(this.options)}`,alreadyWoken?
      {method:'POST',body:JSON.stringify({protocol:2,generation:this.generation,scopes:this.options.scopes??[],cursors:[]})}:{});
    if(this.closed)return;
    if(!syncV2BatchIsValid(input)||input.coverage!=='scope-snapshot'||input.worldId!==this.worldId||input.villageId!==this.villageId
      ||input.generation!==this.generation)throw new SyncV2ResyncRequired();
    this.open(input);
  }
  private open(input:SyncV2Batch){
    // Same per-tab convention as pending constructions: world and village.
    this.pendingKey=`arbestra:pending-processing:${this.worldSlug}:${this.villageId}`;
    this.session=new SyncV2Session({worldId:this.worldId,villageId:this.villageId,generation:this.generation,scopes:new Map(),
      subscribedScopes:new Set(input.groups.map(group=>`${group.stream.kind}:${group.stream.key}`))},
      (state,observedAt,batch)=>this.options.publish(state,observedAt,batch),this.request);
    this.session.apply(input);
    void this.listen();
  }
  private async listen():Promise<void>{
    if(this.closed||!this.session)return;
    try{await this.session.connect(this.root+'/sync/stream');}
    catch(error){
      if(this.closed)return;
      if(error instanceof SyncV2SessionExpired){this.close();this.options.expired();return;}
      if(error instanceof SyncV2ResyncRequired){try{await this.refresh(true);}catch(refreshError){
        if(refreshError instanceof SyncV2SessionExpired){this.close();this.options.expired();return;}
      }}
    }
    if(!this.closed)this.retry=setTimeout(()=>void this.listen(),2000);
  }
  refresh(snapshot=false):Promise<void>{
    if(this.refreshFlight)return this.refreshFlight;
    this.refreshFlight=(async()=>{
      const session=this.session;if(this.closed||!session)return;
      const cursors=session.cursors;
      const input=await this.json('/sync/read',{method:'POST',body:JSON.stringify({protocol:2,generation:this.generation,
        scopes:cursors.map(({kind,key})=>({kind,key})),cursors:snapshot?[]:cursors})});
      if(!this.closed&&this.session===session)session.apply(input);
    })().finally(()=>{this.refreshFlight=null;});
    return this.refreshFlight;
  }
  reconnect(){void this.refresh().catch(error=>{if(error instanceof SyncV2SessionExpired){this.close();this.options.expired();}});}
  pending():ProcessingCommand[]{
    if(!this.pendingKey)return [];
    try{const data:unknown=JSON.parse(this.storage?.getItem(this.pendingKey)??'[]');
      return Array.isArray(data)?data.filter(processingCommandIsValid).slice(0,32):[];
    }catch{return [];}
  }
  private remember(command:ProcessingCommand,remove=false){
    if(!this.pendingKey)throw Error('Synchronisation non initialisée.');
    const pending=this.pending().filter(row=>row.commandId!==command.commandId);
    if(!remove){if(pending.length>=32)throw Error('Trop de commandes à vérifier.');pending.push(command);}
    if(pending.length)this.storage?.setItem(this.pendingKey,JSON.stringify(pending));else this.storage?.removeItem(this.pendingKey);
  }
  /** Drops the intention locally only; an already committed command is not
   * undone and its effects still arrive through the private stream. */
  forget(commandId:string){
    const command=this.pending().find(row=>row.commandId===commandId);
    if(command)this.remember(command,true);
  }
  /** After a reload or a lost response: applied receipts are final and
   * their effects are already in the fresh projection. Absent receipts stay
   * unknown and are returned for an explicit retry with the same UUID. */
  async recover():Promise<ProcessingCommand[]>{
    const pending=this.pending();
    if(this.closed||!pending.length)return pending;
    const input=await this.json('/commands/receipts/read',{method:'POST',
      body:JSON.stringify({commands:pending.map(({commandId})=>({family:'processing',commandId}))})});
    if(!commandReceiptReadResponseIsValid(input)||input.worldId!==this.worldId||input.villageId!==this.villageId)
      throw Error('Reçus de commande invalides.');
    const applied=new Set(input.receipts.filter(receipt=>receipt.family==='processing').map(receipt=>receipt.commandId));
    for(const command of pending)if(applied.has(command.commandId))this.remember(command,true);
    return this.pending();
  }
  async processing(command:ProcessingCommand):Promise<ProcessingConfirmationV2>{
    if(this.closed||!this.session)throw Error('Synchronisation indisponible.');
    this.remember(command);
    let input:unknown;
    try{input=await this.json('/processing',{method:'POST',body:JSON.stringify(command)});}
    catch(error){
      // A business refusal rolled back without mutation: nothing to verify.
      if(error instanceof SyncV2HttpError&&error.status>=400&&error.status<500)this.remember(command,true);
      throw error;
    }
    if(!processingConfirmationV2IsValid(input)||input.commandId!==command.commandId||input.worldId!==this.worldId||input.villageId!==this.villageId)
      throw Error('Confirmation de fabrication invalide.');
    // An applied receipt is final even if its effects need a fresh projection.
    this.remember(command,true);
    if(!this.closed&&input.effects){try{this.session.apply(input.effects);}catch(error){
      if(!(error instanceof SyncV2ResyncRequired))throw error;
      this.reconnect();
    }}
    return input;
  }
  /** Building placement on the V2 contract. Uncertain outcomes are kept by
   * the caller's existing construction intent (same UUID on retry). */
  async construct(body:{commandId:string;buildingType:string;anchorCellX:number;anchorCellY:number;cells:Array<{cellX:number;cellY:number}>;
    expectedCosts:Array<{resourceCode:string;amount:number}>;quarterTurns:number;houseVariant:'stone'|'logs'|'beams'}):Promise<ConstructionConfirmationV2>{
    if(this.closed||!this.session)throw Error('Synchronisation indisponible.');
    const input=await this.json('/buildings',{method:'POST',body:JSON.stringify(body)});
    if(!constructionConfirmationV2IsValid(input)||input.commandId!==body.commandId||input.worldId!==this.worldId||input.villageId!==this.villageId)
      throw Error('Confirmation de construction invalide.');
    if(!this.closed&&input.effects){try{this.session.apply(input.effects);}catch(error){
      if(!(error instanceof SyncV2ResyncRequired))throw error;
      this.reconnect();
    }}
    return input;
  }
  /** Versioned presentation read; null when the given version is current. */
  async presentation(version?:string):Promise<VillagePresentation|null>{
    const response=await this.request(this.root+'/presentation',{credentials:'same-origin',signal:this.controller.signal,
      headers:{'x-arbestra-protocol':'2',...(version?{'if-none-match':`"${version}"`}:{})}});
    if(response.status===304)return null;
    if(response.status===401)throw new SyncV2SessionExpired();
    const data:unknown=await response.json();
    if(!response.ok)throw new SyncV2HttpError(response.status,(data as {code?:string}).code??'HTTP_ERROR','Présentation indisponible.');
    if(!villagePresentationIsValid(data)||data.worldId!==this.worldId||data.villageId!==this.villageId)throw Error('Présentation invalide.');
    return data;
  }
  close(){this.closed=true;this.controller.abort();this.session?.close();if(this.retry)clearTimeout(this.retry);}
}
