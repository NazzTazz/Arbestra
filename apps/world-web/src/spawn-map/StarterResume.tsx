import {useEffect,useState} from 'react';
import type {StarterInstallation} from '@arbestra/contracts';
import {villageRoute} from './starter-route';
import './placement.css';
export function StarterResume({slug,villageId}:{slug:string;villageId:string}){
 const [remaining,setRemaining]=useState(0);
 useEffect(()=>{let live=true;void fetch('/api/worlds/'+encodeURIComponent(slug)+'/starter').then(r=>r.ok?r.json():null).then((r:{installation:StarterInstallation|null}|null)=>{if(live&&r?.installation?.villageId===villageId)setRemaining(r.installation.remaining.length);}).catch(()=>{});return()=>{live=false;};},[slug,villageId]);
 return remaining?<a className="starter-resume" href={villageRoute(slug,true)}>Kit de départ : {remaining} éléments à poser</a>:null;
}
