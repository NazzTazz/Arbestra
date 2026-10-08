import { useEffect, useRef, useState } from 'react';
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color4 } from '@babylonjs/core/Maths/math.color';
import { createTerrainKit, type TerrainPiece, type TerrainFinish } from '../scene/terrain-kit';

const pieces: {id:TerrainPiece;label:string}[]=[{id:'flat',label:'Sol plat'},{id:'stairs',label:'Escalier naturel'},{id:'wall',label:'Paroi droite'},{id:'outer-corner',label:'Angle extérieur'},{id:'inner-corner',label:'Angle intérieur'}];
export function TerrainKitPreview(){
  const canvas=useRef<HTMLCanvasElement>(null);
  const [piece,setPiece]=useState<TerrainPiece>('wall'),[finish,setFinish]=useState<TerrainFinish>('rock');
  const [turn,setTurn]=useState(0),[variant,setVariant]=useState(0);
  const controls=useRef<{update:(p:TerrainPiece,f:TerrainFinish,t:number,v:number)=>void;reset:()=>void}|null>(null);
  useEffect(()=>{
    const engine=new Engine(canvas.current!,true,{preserveDrawingBuffer:true}),scene=new Scene(engine);
    scene.clearColor=new Color4(.07,.10,.13,1);
    const camera=new ArcRotateCamera('kit-camera',-Math.PI/2-.55,1.12,7,new Vector3(0,.12,0),scene);
    camera.radius=10;camera.minZ=.01;camera.lowerRadiusLimit=.7;camera.upperRadiusLimit=16;camera.wheelPrecision=35;camera.attachControl(canvas.current!,false);
    new HemisphericLight('kit-light',new Vector3(-.4,1,-.6),scene);
    const kit=createTerrainKit(scene);
    let instance=kit.instantiate('wall','rock');
    let activePiece:TerrainPiece='wall';
    let activeFinish:TerrainFinish='rock';
    controls.current={update(p,f,t,v){if(p!==activePiece||f!==activeFinish){camera.radius=f==='rock'&&p!=='stairs'?10:p==='stairs'?7:p==='flat'?1.6:3.4;activePiece=p;activeFinish=f;}instance.dispose();instance=kit.instantiate(p,f,v);instance.rotation.y=t*Math.PI/2;},reset(){camera.alpha=-Math.PI/2-.55;camera.beta=1.12;camera.radius=activeFinish==='rock'&&activePiece!=='stairs'?10:activePiece==='stairs'?7:activePiece==='flat'?1.6:3.4;camera.setTarget(new Vector3(0,.12,0));}};
    engine.runRenderLoop(()=>scene.render());
    const resize=new ResizeObserver(()=>engine.resize());resize.observe(canvas.current!);
    return()=>{controls.current=null;resize.disconnect();instance.dispose();kit.dispose();scene.dispose();engine.dispose();};
  },[]);
  useEffect(()=>controls.current?.update(piece,finish,turn,variant),[piece,finish,turn,variant]);
  return <main style={{padding:24,color:'#edf2e6',background:'#121b23',minHeight:'100vh',boxSizing:'border-box'}}>
    <h1>Kit de terrain</h1><p>Prototype de raccords · 1 unité de hauteur = ¼ de case · géométrie visuelle indépendante de la grille logique.</p>
    <div style={{display:'flex',gap:16,flexWrap:'wrap',alignItems:'center'}}>
      <label>Module <select value={piece} onChange={e=>setPiece(e.target.value as TerrainPiece)}>{pieces.filter(p=>finish==='earth'||!['inner-corner','outer-corner'].includes(p.id)).map(p=><option key={p.id} value={p.id}>{finish==='rock'?(p.id==='flat'?'Sol rocheux':p.id==='wall'?'Affleurements':p.label):p.label}</option>)}</select></label>
      <label>Matière <select value={finish} onChange={e=>{const value=e.target.value as TerrainFinish;setFinish(value);if(value==='rock'&&['inner-corner','outer-corner'].includes(piece))setPiece('wall');}}><option value="earth">Terre et herbe</option><option value="rock">Roche</option></select></label>
      <label>Variation <select value={variant} onChange={e=>setVariant(Number(e.target.value))}>{[0,1,2].map(v=><option key={v} value={v}>{v+1}</option>)}</select></label>
      <button onClick={()=>setTurn(t=>(t+1)%4)}>Tourner 90° ({turn*90}°)</button><button onClick={()=>controls.current?.reset()}>Recentrer</button>
    </div>
    <p>{finish==='rock'&&piece!=='stairs'?'Zone de 8 × 6 cases · surface continue à facettes · perturbations en coordonnées mondiales.':'Profil de terrain logique conservé.'} Glisser pour orbiter, molette pour zoomer.</p>
    <canvas ref={canvas} aria-label="Aperçu 3D du kit de terrain" style={{width:'100%',height:'65vh',display:'block',touchAction:'none'}} />
    <p>Atelier visuel uniquement : intégration au terrain du village prévue dans la tranche 4.</p><a href="/geography-preview">Prototype géographique</a> · <a href="/world-generator">Retour au World generator</a>
  </main>;
}
