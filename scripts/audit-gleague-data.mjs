import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root=path.resolve(import.meta.dirname,'..');
const file=path.join(root,'site','dist','gleague','data.generated.js');
if(!fs.existsSync(file)) throw new Error('data.generated.js missing');
const sandbox={window:{}}; vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox);
const data=sandbox.window.GLEAGUE_DATA;
if(!data||!Array.isArray(data.cards)) throw new Error('Invalid data payload');
const expected=['LIN','WES','WCB','MNE','CLC','MCC','WIS','NOB','GBO','CPS','CCG','DEL','RAP','OSC','BIR','GRG','CVL','SDC','SCW','STO','VAL','RIP','SLC','OKL','AUS','TEX','RGV','MHU','IWA','SXF','MXC','GLI'];
const slots=['PG','SG','SF','PF','C','G','F','UTIL'];
const fits=(card,slot)=>slot==='UTIL'||(slot==='G'?card.positions.some(p=>p==='PG'||p==='SG'):(slot==='F'?card.positions.some(p=>p==='SF'||p==='PF'):card.positions.includes(slot)));
const failures=[];
for(const code of expected){
 const cards=data.cards.filter(c=>c.teamCode===code);
 if(!cards.length) failures.push(`${code}: no cards`);
 for(const slot of slots){const count=cards.filter(c=>fits(c,slot)).length;if(count<5) failures.push(`${code}: only ${count} ${slot} cards`);}
}
for(const c of data.cards){
 for(const k of ['id','playerId','name','season','teamCode','positions','overall','headshotUrl','gp','ppg','rpg','apg','accolades']) if(c[k]===undefined||c[k]===null) failures.push(`${c.id||'?'} missing ${k}`);
 if(c.overall<60||c.overall>97) failures.push(`${c.id} invalid OVR ${c.overall}`);
}
const ids=new Set(data.cards.map(c=>c.id)); if(ids.size!==data.cards.length) failures.push('duplicate card IDs');
const lin=data.cards.filter(c=>c.teamCode==='LIN');
const ignite=data.cards.filter(c=>c.teamCode==='GLI');
const mac=data.cards.filter(c=>c.name==='Mac McClung'&&['2023-24','2025-26'].includes(c.season));
if(!lin.length) failures.push('Long Island Nets unreachable');
if(!ignite.length) failures.push('G League Ignite missing');
if(mac.some(c=>c.overall<95)) failures.push('Mac McClung MVP cards below 95');
console.log(JSON.stringify({cards:data.cards.length,teams:expected.length,longIsland:lin.length,ignite:ignite.length,mac:mac.map(c=>({season:c.season,overall:c.overall,team:c.teamCode})),failures:failures.slice(0,100)},null,2));
if(failures.length){console.warn(`Audit found ${failures.length} issues; dataset remains usable but complete flag should be false.`); if(data.complete) process.exit(2);}
