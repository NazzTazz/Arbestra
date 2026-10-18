import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import type {Building,MarketState} from '@arbestra/contracts';
import {MarketPanel} from '../src/ui/MarketPanel';
import {WorldContextMenu} from '../src/ui/WorldContextMenu';
import '../src/styles.css';

const building:Building={id:'layout-hall',type:'town-hall',level:2,targetLevel:null,status:'completed',constructionStartedAt:null,constructionCompletesAt:null,completedAt:'2026-10-18T00:00:00Z',hiddenSuppliesAvailable:false,garden:null};
const market:MarketState={unlocked:true,deliveryMs:0,commissionPercent:30,exchanges:[],
  resources:[['wood','Bois brut',100],['timber','Bois d’œuvre',150],['stone','Pierre brute',100],['cut-stone','Pierre taillée',150],['carrot','Carottes',25]].map(([code,displayName,valueUnits])=>({code:String(code),displayName:String(displayName),iconKey:String(code),valueUnits:Number(valueUnits)})),
  journeys:[{id:'layout-journey',villageId:'layout-village',destinationVillageId:'other-village',workerCount:2,path:[{cellX:0,cellY:0},{cellX:1,cellY:0}],startedAt:'2026-10-18T00:00:00Z',arrivesAt:'2026-10-18T00:01:00Z',returnsAt:'2026-10-18T00:02:00Z'}]};
function Fixture(){
  const [revision,setRevision]=useState(0);
  return <><button style={{position:'fixed',top:8,right:8,zIndex:1000}} onClick={()=>setRevision(n=>n+1)}>Simuler une révision</button>
    <WorldContextMenu anchor={{x:8,y:window.innerHeight-80}}><MarketPanel slug="layout-fixture" villageId="layout-village" building={building} market={market} stocks={[]} serverNow={Date.parse('2026-10-18T00:00:00Z')} revision={String(revision)} pending={false} error={null} onCommand={async()=>false} onUpgrade={()=>{}}/></WorldContextMenu></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
