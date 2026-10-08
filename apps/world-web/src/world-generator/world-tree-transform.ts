import { Matrix,Quaternion,Vector3 } from '@babylonjs/core/Maths/math.vector';
import { torusFrame } from '@arbestra/contracts/cosmology';
/** Actual cell-width scale on the minor circle; exaggeration changes terrain height only. */
export function torusTreeMatrix(x:number,y:number,ground:number,offset:number,width:number,height:number,exaggeration:number,size=1,crown=1){
  const frame=torusFrame(x/width*Math.PI*2,y/height*Math.PI*2+Math.PI),scale=Math.PI*2/height;
  const normal=Vector3.FromArray([...frame.normal]),rotation=Quaternion.Identity();
  Quaternion.FromUnitVectorsToRef(Vector3.Up(),normal,rotation);
  const position=Vector3.FromArray([...frame.point]).add(normal.scale((ground*exaggeration+offset*size)*scale));
  return Matrix.Compose(new Vector3(scale*size*crown,scale*size,scale*size*crown),rotation,position);
}
