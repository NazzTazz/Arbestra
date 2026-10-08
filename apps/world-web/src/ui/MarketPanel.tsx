import { randomUUID } from '../random-uuid';
import { useEffect, useState } from 'react';
import { MARKET_MAX_AMOUNT, type Building, type MarketCommand, type MarketPreview, type MarketState, type VillageState } from '@arbestra/contracts';
import { previewMarket } from '../api/client';

export function MarketPanel({slug,villageId,building,market,stocks,serverNow,revision,pending,error,onCommand,onUpgrade}: {
  slug:string;villageId:string;building:Building;market:MarketState;stocks:VillageState['village']['resources'];
  serverNow:number;revision:string;pending:boolean;error:string|null;
  onCommand:(command:MarketCommand)=>Promise<boolean>;onUpgrade:()=>void;
}) {
  const [offeredResource,setOffered] = useState('wood'), [requestedResource,setRequested] = useState('stone');
  const [amount,setAmount] = useState('100');
  const [quoted,setQuoted] = useState<{key:string;preview:MarketPreview}|null>(null);
  const [quoteError,setQuoteError] = useState<string|null>(null), [retry,setRetry] = useState<MarketCommand|null>(null);
  const n=Number(amount), key=JSON.stringify([slug,villageId,offeredResource,requestedResource,n,revision]);
  const validAmount=Number.isSafeInteger(n)&&n>0&&n<=MARKET_MAX_AMOUNT;
  useEffect(()=>{
    if(!market.unlocked||!validAmount)return;
    let cancelled=false;
    setQuoteError(null);
    void previewMarket(slug,villageId,{offeredResource,requestedResource,amount:n})
      .then(preview=>{if(!cancelled)setQuoted({key,preview});})
      .catch(reason=>{if(!cancelled){setQuoted(null);setQuoteError(reason instanceof Error?reason.message:'Devis indisponible.');}});
    return ()=>{cancelled=true;};
  },[slug,villageId,offeredResource,requestedResource,n,key,market.unlocked,validAmount]);
  const preview=quoted?.key===key?quoted.preview:null;
  const name=(code:string)=>market.resources.find(r=>r.code===code)?.displayName??stocks.find(r=>r.code===code)?.displayName??code;
  async function send(command:MarketCommand){setRetry(command);if(await onCommand(command))setRetry(null);}
  const enough=stocks.find(r=>r.code==='timber')?.amount??0;
  const stone=stocks.find(r=>r.code==='cut-stone')?.amount??0;
  return <section className="market-panel" aria-label="Place de marché">
    <h3>Place de marché</h3>
    <p>Anneaux : {(stocks.find(r=>r.code==='rings')?.amount??0).toLocaleString('fr-FR')} · monnaie à venir.</p>
    {!market.unlocked?<>
      <p>Le marché ouvre au second étage de l’hôtel de ville, au niveau 2.</p>
      {building.level===1&&building.status==='completed'&&<>
        <p>Amélioration : 500 bois d’œuvre + 120 pierres taillées · 10 minutes.</p>
        <button type="button" disabled={pending||enough<500||stone<120} onClick={onUpgrade}>Améliorer l’hôtel de ville</button>
      </>}
    </>:<>
      <p>L’Oracle livre par l’intérieur du tore en 10 minutes. Commission : 30 %.</p>
      <label>Ressource offerte <select aria-label="Ressource offerte" value={offeredResource} disabled={pending||!!retry} onChange={e=>setOffered(e.target.value)}>
        {market.resources.map(r=><option key={r.code} value={r.code}>{r.displayName}</option>)}
      </select></label>
      <label>Quantité offerte <input aria-label="Quantité offerte" type="number" min={1} max={MARKET_MAX_AMOUNT} step={1} value={amount} disabled={pending||!!retry} onChange={e=>setAmount(e.target.value)}/></label>
      <p>Stock : {(stocks.find(r=>r.code===offeredResource)?.amount??0).toLocaleString('fr-FR')} {name(offeredResource)}.</p>
      <label>Ressource demandée <select aria-label="Ressource demandée" value={requestedResource} disabled={pending||!!retry} onChange={e=>setRequested(e.target.value)}>
        {market.resources.map(r=><option key={r.code} value={r.code}>{r.displayName}</option>)}
      </select></label>
      {preview&&<p role="status">Vous recevrez {preview.receivedAmount.toLocaleString('fr-FR')} {name(requestedResource)} dans 10 minutes.{preview.message&&` ${preview.message}`}</p>}
      {!validAmount&&<p>Choisissez une quantité entière positive.</p>}
      {quoteError&&<p role="alert">{quoteError}</p>}
      <small>Débit immédiat à la confirmation. Échange définitif, sans habitant mobilisé.</small>
      <button type="button" disabled={pending||!!retry||!validAmount||!preview?.valid} onClick={()=>void send({commandId:randomUUID(),offeredResource,requestedResource,amount:n,expectedReceivedAmount:preview!.receivedAmount})}>Confirmer le troc</button>
      {retry&&!pending&&<><p>Vérifiez la même commande avant de recommencer si son résultat est incertain.</p>
        <button type="button" onClick={()=>void send(retry)}>Vérifier le même échange</button>
        <button type="button" onClick={()=>setRetry(null)}>Modifier la demande</button></>}
    </>}
    {market.exchanges.length>0&&<><h4>Livraisons</h4><ul>{market.exchanges.map(e=><li key={e.id}>
      {e.offeredAmount} {name(e.offeredResource)} → {e.receivedAmount} {name(e.requestedResource)} · {e.completedAt?'Livré':`En livraison · ${Math.max(0,Math.ceil((Date.parse(e.completesAt)-serverNow)/1000))} s`}
    </li>)}</ul></>}
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
