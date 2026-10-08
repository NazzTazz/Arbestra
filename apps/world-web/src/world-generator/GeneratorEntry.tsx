import { useEffect, useState } from 'react';
export function GeneratorEntry(){
  const [allowed,setAllowed]=useState(false);
  useEffect(()=>{const abort=new AbortController();
    void fetch('/api/admin/world-generator',{credentials:'include',signal:abort.signal}).then(r=>{if(r.ok)setAllowed(true);}).catch(()=>{});
    return()=>abort.abort();
  },[]);
  return allowed?<a style={{position:'fixed',top:12,right:12,zIndex:200,padding:8,background:'#102334',color:'#dbe8f1',border:'1px solid #708ca5',borderRadius:5}} href="/world-generator">World generator</a>:null;
}
