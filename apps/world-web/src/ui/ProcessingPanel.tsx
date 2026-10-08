import { randomUUID } from '../random-uuid';
import { useEffect, useState } from 'react';
import type { Building, ProcessingCommand, ProcessingOrder, ProcessingPreview, ProcessingRecipe } from '@arbestra/contracts';
import { previewProcessing } from '../api/client';

const names: Record<string,string> = { wood:'bois bruts',stone:'pierres brutes',timber:'bois d’œuvre','cut-stone':'pierres taillées' };
const statuses: Record<ProcessingOrder['status'],string> = {
  running:'Fabrication en cours', 'pause-requested':'Pause après ce lot', 'cancel-requested':'Annulation après ce lot',
  paused:'En pause',blocked:'En attente',completed:'Commande terminée',cancelled:'Commande annulée',
};
export function ProcessingPanel({ slug,villageId,building,recipe,orders,serverNow,revision,pending,error,onCommand }: {
  slug:string;villageId:string;building:Building;recipe:ProcessingRecipe;orders:ProcessingOrder[];serverNow:number;revision:string;
  pending:boolean;error:string|null;onCommand:(command:ProcessingCommand)=>Promise<boolean>;
}) {
  const [lots,setLots] = useState(1), [workers,setWorkers] = useState(1);
  const [preview,setPreview] = useState<ProcessingPreview|null>(null);
  const [previewError,setPreviewError] = useState<string|null>(null);
  const [retry,setRetry] = useState<ProcessingCommand|null>(null);
  const order = orders.find(o=>o.buildingId===building.id && !['completed','cancelled'].includes(o.status));
  const last = order ?? orders.find(o=>o.buildingId===building.id);
  const busy = Boolean(order?.currentLot), orderId = order?.id;
  useEffect(()=>{
    if(busy || building.status!=='completed')return;
    let cancelled=false;
    setPreview(null);setPreviewError(null);
    void previewProcessing(slug,villageId,building.id,workers,orderId).then(value=>{if(!cancelled)setPreview(value);})
      .catch(reason=>{if(!cancelled)setPreviewError(reason instanceof Error?reason.message:'Devis indisponible.');});
    return ()=>{cancelled=true;};
  },[slug,villageId,building.id,building.status,workers,orderId,busy,revision]);
  async function send(command:ProcessingCommand) {
    setRetry(command);
    if(await onCommand(command))setRetry(null);
  }
  const remainingMs = order?.currentLot ? Math.max(0,Date.parse(order.currentLot.completesAt)-serverNow) : 0;
  const durationMs = Math.ceil(recipe.workMs/workers);
  const remainingLots = order ? order.requestedLots-order.completedLots : lots;
  return <section className="processing-panel" aria-label="Fabrication de matières">
    <strong>{names[recipe.outputResource]}</strong>
    <p>Par lot : {recipe.inputAmount} {names[recipe.inputResource]} → {recipe.outputAmount} {names[recipe.outputResource]}.</p>
    {last && <p role="status">{statuses[last.status]} · {last.completedLots}/{last.requestedLots} lots achevés</p>}
    {order?.blockedReason && <p>{order.blockedReason==='missing-input'?'Matière brute insuffisante.':'Habitants disponibles et aptes insuffisants.'} Reprenez quand la situation le permet.</p>}
    {busy && order?.currentLot && <>
      <p>{order.workerCount} habitant{order.workerCount>1?'s':''} au travail · {order.currentLot.inputAmount} {names[order.currentLot.inputResource]} engagées · {order.currentLot.outputAmount} {names[order.currentLot.outputResource]} à recevoir dans {Math.ceil(remainingMs/1000)} s.</p>
      <progress aria-label="Avancement du lot" max={1} value={Math.min(1,Math.max(0,(serverNow-Date.parse(order.currentLot.startedAt))/(Date.parse(order.currentLot.completesAt)-Date.parse(order.currentLot.startedAt))))}/>
      <div><button type="button" disabled={pending||!!retry||order.status!=='running'} onClick={()=>void send({commandId:randomUUID(),action:'pause',orderId:order.id})}>Pause après ce lot</button>
      <button type="button" disabled={pending||!!retry||order.status==='cancel-requested'} onClick={()=>void send({commandId:randomUUID(),action:'cancel',orderId:order.id})}>Annuler après ce lot</button></div>
    </>}
    {!busy && building.status==='completed' && <>
      {!order && <label>Lots <input aria-label="Nombre de lots" type="number" min={1} max={20} value={lots} disabled={pending||!!retry} onChange={e=>setLots(Math.max(1,Math.min(20,Math.floor(Number(e.target.value)||1))))}/></label>}
      <label>Habitants <input aria-label="Habitants affectés à la fabrication" type="number" min={1} max={recipe.workerCap} value={workers} disabled={pending||!!retry} onChange={e=>setWorkers(Math.max(1,Math.min(recipe.workerCap,Math.floor(Number(e.target.value)||1))))}/></label>
      <p>{Math.ceil(durationMs/1000)} s par lot · {remainingLots*recipe.inputAmount} {names[recipe.inputResource]} prévues → {remainingLots*recipe.outputAmount} {names[recipe.outputResource]}.</p>
      <small>Prochain débit : {recipe.inputAmount} {names[recipe.inputResource]}. Les lots suivants ne sont pas réservés.</small>
      {preview?.message && <p role="status">{preview.message}</p>}{previewError && <p className="error">{previewError}</p>}
      <button type="button" disabled={pending||!!retry||!preview?.valid} onClick={()=>void send(order
        ? {commandId:randomUUID(),action:'resume',orderId:order.id,workerCount:workers}
        : {commandId:randomUUID(),action:'start',buildingId:building.id,lots,workerCount:workers})}>{order?'Reprendre':'Fabriquer'}</button>
      {order && <button type="button" disabled={pending||!!retry} onClick={()=>void send({commandId:randomUUID(),action:'cancel',orderId:order.id})}>Annuler les lots restants</button>}
    </>}
    {retry && !pending && <div><p>Commande à vérifier ou corriger.</p><button type="button" onClick={()=>void send(retry)}>Vérifier la même commande</button><button type="button" onClick={()=>{setRetry(null);}}>Modifier la demande</button></div>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
