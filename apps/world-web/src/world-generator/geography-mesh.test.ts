import { describe, expect, it } from 'vitest';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { createGeographyFixture, DEFAULT_GEOGRAPHY, sampleGeography } from '@arbestra/contracts/geography-prototype';
import { buildGeographyChunk, type GeographyChunk } from './geography-mesh';
const edge=(c:GeographyChunk,x:number)=>c.boundary.filter(p=>p[0]===x).map(p=>[p[1],p[2]]).sort((a,b)=>a[1]!-b[1]!);

describe('constrained geography chunks',()=>{
  it('joins adjacent independently generated chunks including river banks',()=>{
    const d=createGeographyFixture(DEFAULT_GEOGRAPHY);
    const b=buildGeographyChunk(d,32,0),a=buildGeographyChunk(d,0,0);
    expect(edge(a,32)).toEqual(edge(b,32));
    expect(edge(a,32).length).toBeGreaterThan(33); // actual bank/chunk intersections
    expect(buildGeographyChunk(d,0,0)).toEqual(a);
    expect(buildGeographyChunk(d,32,0)).toEqual(b);
  });
  it('joins the x/y torus seams and keeps boundary data at both mesh densities',()=>{
    const d=createGeographyFixture(DEFAULT_GEOGRAPHY);
    const a=buildGeographyChunk(d,-32,0),b=buildGeographyChunk(d,0,0,2);
    expect(edge(a,0)).toEqual(edge(b,0));
    const copy=buildGeographyChunk(d,128,0,2);
    expect(copy.ground.positions).toEqual(b.ground.positions);
    expect(copy.water.positions).toEqual(b.water.positions);
    const upper=buildGeographyChunk(d,0,32),lower=buildGeographyChunk(d,0,0);
    const horizontal=(c:GeographyChunk,y:number)=>c.boundary.filter(p=>p[2]===y).map(p=>[p[0],p[1]]).sort((a,b)=>a[0]!-b[0]!);
    expect(horizontal(upper,64)).toEqual(horizontal(lower,0));
  });
  it('has finite upward faces and one nonoverlapping water surface on the carved bed',()=>{
    const d=createGeographyFixture(DEFAULT_GEOGRAPHY),c=buildGeographyChunk(d,32,0);
    for(const buffer of [c.ground,c.water]){
      expect([...buffer.positions].every(Number.isFinite)).toBe(true);
      const normals:number[]=[];VertexData.ComputeNormals(buffer.positions,buffer.indices,normals);
      for(let i=1;i<normals.length;i+=3)expect(normals[i]).toBeGreaterThan(0);
    }
    const faces=new Set<string>();
    for(let i=0;i<c.water.positions.length;i+=9){
      const p=c.water.positions,key=Array.from(p.slice(i,i+9)).join(',');expect(faces.has(key)).toBe(false);faces.add(key);
      const x=(p[i]!+p[i+3]!+p[i+6]!)/3+c.x,y=(p[i+2]!+p[i+5]!+p[i+8]!)/3+c.y;
      const s=sampleGeography(d,x,y);expect(s.waterLevel).not.toBeNull();expect(s.depth).toBeGreaterThan(0);
    }
  });
  it('qualifies multiple river shapes without constraint errors',()=>{
    for(const seed of [1,7,1234])for(const width of [5,8]){
      const d=createGeographyFixture({...DEFAULT_GEOGRAPHY,seed,riverWidth:width,bankRoughness:1});
      const a=buildGeographyChunk(d,0,0),b=buildGeographyChunk(d,32,0);
      expect(edge(a,32)).toEqual(edge(b,32));expect(a.water.indices.length).toBeGreaterThan(0);
    }
  });
});
