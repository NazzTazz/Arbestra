import {it,expect} from 'vitest';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {attachFrostedGlass} from './frosted-glass';

it('renders frosted panes without capturing the scene and shares their material across removal',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    MeshBuilder.CreateBox('wall',{},scene);
    const first=MeshBuilder.CreatePlane('first',{},scene),second=MeshBuilder.CreatePlane('second',{},scene);
    attachFrostedGlass(first);attachFrostedGlass(second);
    expect(scene.customRenderTargets).toHaveLength(0);
    expect(scene.textures.filter(t=>t.isRenderTarget)).toHaveLength(0);
    expect(first.material).toBe(second.material);
    expect(first.material!.needAlphaBlending()).toBeFalsy();
    first.dispose(false,false);
    expect(scene.materials).toContain(second.material);
    expect(second.material!.getScene()).toBe(scene);
    const material=second.material as StandardMaterial,reflection=material.reflectionTexture!;
    expect(reflection.isRenderTarget).toBeFalsy();expect(reflection.getSize()).toMatchObject({width:32,height:16});
    expect(material.diffuseFresnelParameters).toBeFalsy();
    const daylight=new HemisphericLight('daylight',Vector3.Up(),scene);daylight.intensity=1;
    scene.onBeforeRenderObservable.notifyObservers(scene);expect(reflection.level).toBeCloseTo(.7);
    daylight.intensity=.1;scene.onBeforeRenderObservable.notifyObservers(scene);expect(reflection.level).toBeCloseTo(.07);
    daylight.setEnabled(false);scene.onBeforeRenderObservable.notifyObservers(scene);expect(reflection.level).toBe(0);
  }finally{scene.dispose();engine.dispose();}
});
