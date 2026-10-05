import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {FrostedGlass} from './frosted-glass';

it('keeps the background capture list stable and excludes glass while handling streamed meshes',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const wall=MeshBuilder.CreateBox('wall',{},scene),pane=MeshBuilder.CreatePlane('glass',{},scene),glass=new FrostedGlass(scene);
    glass.attach(pane);scene.onBeforeRenderTargetsRenderObservable.notifyObservers(scene);
    const list=glass.capture.renderList;expect(list?.slice()).toEqual([wall]);expect(glass.capture.renderListPredicate).toBeUndefined();
    scene.onBeforeRenderTargetsRenderObservable.notifyObservers(scene);expect(glass.capture.renderList).toBe(list);
    const tree=MeshBuilder.CreateBox('tree',{},scene);
    // Babylon defers the mesh-added notification until its geometry is assigned.
    await new Promise(resolve=>setTimeout(resolve,20));scene.onBeforeRenderTargetsRenderObservable.notifyObservers(scene);
    expect(glass.capture.renderList?.map(m=>m.name)).toEqual([wall.name,tree.name]);wall.dispose();scene.onBeforeRenderTargetsRenderObservable.notifyObservers(scene);
    expect(glass.capture.renderList?.map(m=>m.name)).toEqual([tree.name]);pane.dispose();expect(scene.customRenderTargets).not.toContain(glass.capture);
  }finally{scene.dispose();engine.dispose();}
});
