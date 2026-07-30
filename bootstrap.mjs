import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const siteRoot=path.join(HERE,'site','dist');
if(!fs.existsSync(path.join(siteRoot,'index.html'))){
  fs.mkdirSync(path.join(HERE,'site'),{recursive:true});
  const archive=path.join(HERE,'site.tar.gz');
  if(!fs.existsSync(archive)){
    const encoded=fs.readdirSync(HERE).filter(name=>name.startsWith('site.tar.gz.b64.part')).sort().map(name=>fs.readFileSync(path.join(HERE,name),'utf8')).join('').replace(/\s+/g,'');
    fs.writeFileSync(archive,Buffer.from(encoded,'base64'));
  }
  execFileSync('tar',['-xzf',archive,'-C',path.join(HERE,'site')],{stdio:'inherit'});
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.ico':'image/x-icon','.map':'application/json; charset=utf-8'};
const port=Number(process.env.PORT)||3000;
function safeFile(urlPath){
  let pathname;
  try{pathname=decodeURIComponent(new URL(urlPath,'http://local').pathname)}catch{return null}
  if(pathname==='/healthz') return '__health__';
  if(pathname==='/gleague'||pathname==='/gleague/') pathname='/gleague/index.html';
  const normalized=path.posix.normalize(pathname).replace(/^\/+/, '');
  if(normalized.startsWith('..')) return null;
  let target=path.join(siteRoot,normalized);
  if(fs.existsSync(target)&&fs.statSync(target).isDirectory()) target=path.join(target,'index.html');
  if(!fs.existsSync(target)&&!path.extname(normalized)) target=path.join(siteRoot,'index.html');
  if(!target.startsWith(siteRoot)) return null;
  return target;
}
const server=http.createServer((req,res)=>{
  const file=safeFile(req.url||'/');
  if(file==='__health__'){res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return;}
  if(!file||!fs.existsSync(file)){res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Not found');return;}
  const ext=path.extname(file).toLowerCase();
  const immutable=file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200,{'content-type':mime[ext]||'application/octet-stream','cache-control':immutable?'public, max-age=31536000, immutable':(ext==='.html'?'no-cache':'public, max-age=3600')});
  if(req.method==='HEAD'){res.end();return;}
  fs.createReadStream(file).on('error',()=>{if(!res.headersSent)res.writeHead(500);res.end();}).pipe(res);
});
server.listen(port,'0.0.0.0',()=>console.log(`TulipBasketball listening on ${port}`));
