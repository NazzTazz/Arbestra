// Read-only production preview: node tests/browser/village-lod-server.mjs <dist> <port>
/* global process, fetch, Buffer, URL, console */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(process.argv[2]),port=Number(process.argv[3]);
http.createServer(async(req,res)=>{try{
  if(req.url.startsWith('/api/')){if(req.method!=='GET'){res.writeHead(403).end();return;}const upstream=await fetch('http://localhost:3000'+req.url,{headers:{cookie:req.headers.cookie??''}});res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json'});res.end(Buffer.from(await upstream.arrayBuffer()));return;}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.json':'application/json','.gz':'application/octet-stream'};
  const bytes=await readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]??'application/octet-stream'});res.end(bytes);
}catch{res.writeHead(404).end();}}).listen(port,'127.0.0.1',()=>console.log('LOD preview',port));
