import { createGeographyFixture, type GeographyOptions } from '@arbestra/contracts/geography-prototype';
import { buildGeographyChunk } from './geography-mesh';
self.onmessage=(event:MessageEvent<{id:number;options:GeographyOptions;seam:boolean;density:1|2}>)=>{
  const start=performance.now(),{id,options,seam,density}=event.data;
  try{
    const geography=createGeographyFixture(options),x=seam?-32:0;
    const chunks=[buildGeographyChunk(geography,x,0,density),buildGeographyChunk(geography,x+32,0,density)];
    const transfers=chunks.flatMap(c=>[c.ground,c.water].flatMap(b=>[b.positions.buffer,b.indices.buffer,b.colors.buffer,b.flow.buffer]));
    self.postMessage({id,geography,chunks,durationMs:performance.now()-start}, {transfer:transfers});
  }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
