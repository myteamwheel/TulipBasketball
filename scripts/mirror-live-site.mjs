import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const out=path.join(root,'site','dist');
const base='https://tulipbasketball.up.railway.app';
fs.rmSync(path.join(root,'site'),{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
const queue=['/'],seen=new Set();
while(queue.length){const urlPath=queue.shift();if(seen.has(urlPath)||urlPath.startsWith('/gleague'))continue;seen.add(urlPath);const response=await fetch(`${base}${urlPath}`,{redirect:'follow'});if(!response.ok)throw new Error(`${urlPath}: ${response.status}`);const clean=urlPath==='/'?'index.html':urlPath.replace(/^\/+/,''),target=path.join(out,clean);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(await response.arrayBuffer()));const ext=path.extname(target).toLowerCase();if(['.html','.js','.css',''].includes(ext)){const text=fs.readFileSync(target,'utf8');for(const match of text.matchAll(/(?:src=|href=|["'`(])((?:\/assets\/)[A-Za-z0-9_./-]+)/g))if(!seen.has(match[1]))queue.push(match[1])}}
fs.cpSync(path.join(root,'gleague-static'),path.join(out,'gleague'),{recursive:true});
console.log(`Mirrored ${seen.size} live paths and overlaid /gleague`);
