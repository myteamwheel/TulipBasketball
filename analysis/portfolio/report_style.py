CSS = r"""
:root{
  --bg:#f3f5f7; --surface:#fcfcfb; --raise:#ffffff; --ink:#10151b; --ink-2:#48515b; --muted:#7a838d;
  --grid:#e2e5e9; --rule:#cdd2d8; --accent:#2a78d6; --accent-ink:#1c5cab; --tint:#e8f1fc;
  --base:#a9b0b8; --band:#d8dde2; --under:#e34948; --under-tint:#fcebea; --chip:#eef0f3;
  --display:"Barlow Condensed","Arial Narrow",system-ui,sans-serif;
  --body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme:dark; --bg:#0e1013; --surface:#15181c; --raise:#1a1e23; --ink:#eef1f4; --ink-2:#c0c6cd; --muted:#8a939c;
    --grid:#262b31; --rule:#363c43; --accent:#3987e5; --accent-ink:#86b6ef; --tint:#16263a;
    --base:#6c747d; --band:#30363d; --under:#e66767; --under-tint:#3a1f21; --chip:#20252b;
  }
}
:root[data-theme="dark"]{
  color-scheme:dark; --bg:#0e1013; --surface:#15181c; --raise:#1a1e23; --ink:#eef1f4; --ink-2:#c0c6cd; --muted:#8a939c;
  --grid:#262b31; --rule:#363c43; --accent:#3987e5; --accent-ink:#86b6ef; --tint:#16263a;
  --base:#6c747d; --band:#30363d; --under:#e66767; --under-tint:#3a1f21; --chip:#20252b;
}
*{box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font:15px/1.6 var(--body);margin:0}
a{color:var(--accent-ink);text-underline-offset:2px}
.wrap{max-width:1180px;margin:0 auto;padding-inline:20px;padding-block:28px 64px}
header.top{padding-block:8px 20px;border-bottom:1px solid var(--rule);margin-bottom:22px}
.eyebrow{font:600 12px/1.4 var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
h1{font:700 clamp(38px,6vw,64px)/.95 var(--display);letter-spacing:-.01em;margin:10px 0 12px;text-wrap:balance}
.deck{font-size:18px;line-height:1.5;color:var(--ink-2);max-width:62ch;margin:0 0 14px}
.meta{font-size:13px;color:var(--muted);max-width:90ch}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:10px;margin:22px 0 8px}
.kpi{background:var(--raise);border:1px solid var(--rule);border-radius:8px;padding:12px 14px}
.kpi .k{font-size:12.5px;color:var(--ink-2);line-height:1.3}
.kpi .v{font:600 34px/1.05 var(--display);margin-top:6px}
.kpi .c{font-size:12.5px;color:var(--muted)}
.layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:40px;align-items:start}
nav.toc{position:sticky;top:calc(env(safe-area-inset-top,0px) + 16px);font-size:13px;max-height:calc(100vh - 32px);overflow:auto;padding-right:6px}
nav.toc .tt{font:600 12px var(--body);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
nav.toc ol{list-style:none;margin:0;padding:0;display:grid;gap:2px}
nav.toc a{display:grid;grid-template-columns:26px 1fr;padding:3px 6px;border-radius:5px;color:var(--ink-2);text-decoration:none;line-height:1.3}
nav.toc a:hover,nav.toc a:focus-visible{background:var(--chip);color:var(--ink)}
nav.toc a span:first-child{color:var(--muted);font-variant-numeric:tabular-nums}
main{min-width:0}
section{padding-block:26px 30px;border-top:1px solid var(--rule)}
section:first-of-type{border-top:0;padding-top:0}
h2{font:700 32px/1.05 var(--display);margin:0 0 4px;display:flex;gap:12px;align-items:baseline;text-wrap:balance}
h2 .n{font:600 15px var(--body);color:var(--muted);font-variant-numeric:tabular-nums;min-width:24px}
h3{font:600 17px/1.3 var(--body);margin:22px 0 6px}
.lede{font-size:17px;line-height:1.55;margin:8px 0 12px;max-width:70ch}
p{max-width:72ch;margin:0 0 12px}
.note{font-size:13px;color:var(--ink-2);max-width:78ch}
ul.tight{margin:0 0 12px;padding-left:20px;max-width:74ch} ul.tight li{margin:3px 0}
.callout{background:var(--tint);border-radius:8px;padding:12px 16px;margin:14px 0;max-width:78ch}
.callout.warn{background:var(--under-tint)}
.callout b{font-weight:600}
.verdict{display:inline-block;font:600 11.5px var(--body);letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:99px;margin-right:6px;vertical-align:1px;border:1px solid var(--rule);background:var(--raise)}
.verdict.strong{border-color:var(--accent);color:var(--accent-ink)}
.verdict.mod{color:var(--ink-2)}
.verdict.no{border-color:var(--under);color:var(--under)}
.findings{display:grid;gap:10px;margin:14px 0;padding:0;list-style:none;max-width:82ch}
.findings li{background:var(--raise);border:1px solid var(--rule);border-radius:8px;padding:12px 14px}
.figure{background:var(--surface);border:1px solid var(--rule);border-radius:8px;padding:14px 14px 8px;margin:14px 0;max-width:780px}
.figure .ft{font:600 14px var(--body);margin:0 0 2px}
.figure .fs{font-size:12.5px;color:var(--muted);margin:0 0 8px}
svg.chart{width:100%;height:auto;display:block;overflow:visible;font-family:var(--body)}
.chartscroll{overflow-x:auto;overflow-y:hidden;padding-bottom:2px}
.chartscroll svg.chart{min-width:600px}
.chartscroll svg.chart.heat{min-width:440px;max-width:560px}
.chartscroll svg.chart.small{min-width:300px}
svg .grid{stroke:var(--grid);stroke-width:1}
svg .baseline{stroke:var(--rule);stroke-width:1}
svg .axis{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
svg .lab{fill:var(--ink);font-size:12.5px}
svg .mono{font-variant-numeric:tabular-nums}
svg .val{font-size:12px;fill:var(--ink-2);font-variant-numeric:tabular-nums}
svg .val .strong, svg .strong{fill:var(--ink);font-weight:600}
svg .val .soft{fill:var(--muted)}
svg .band{fill:var(--band)}
svg .meantick{stroke:var(--base);stroke-width:2;stroke-linecap:round}
svg .dot-me{fill:var(--accent);stroke:var(--surface);stroke-width:2}
svg .dot-base{fill:var(--base);stroke:var(--surface);stroke-width:2}
svg .connector{stroke:var(--band);stroke-width:2}
svg .line{stroke-width:2;stroke-linejoin:round;stroke-linecap:round} svg .line-me{stroke:var(--accent)} svg .line-base{stroke:var(--base)}
svg .bar-me{fill:var(--accent)} svg .bar-base{fill:var(--base)}
svg .bar-over{fill:var(--accent)} svg .bar-under{fill:var(--under)}
svg .cell{fill:var(--accent)} svg .cell-diag{fill:var(--chip)}
svg .cell-txt-dark{fill:var(--ink);font-size:13px;font-weight:600} svg .cell-txt-light{fill:#fff;font-size:13px;font-weight:600}
svg .hitbox{fill:transparent}
svg .hit{outline:none}
svg .hit:hover .hitbox, svg .hit:focus-visible .hitbox{fill:var(--chip)}
.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12.5px;color:var(--ink-2);margin:0 0 6px}
.key{display:inline-flex;align-items:center;gap:6px}
.sw{display:inline-block}
.sw-dot{width:10px;height:10px;border-radius:50%} .sw-dot.me{background:var(--accent)} .sw-dot.base{background:var(--base)}
.sw-band{width:22px;height:8px;border-radius:4px;background:var(--band)}
.sw-tick{width:2px;height:14px;background:var(--base);border-radius:1px}
.sw-bar{width:14px;height:10px;border-radius:2px} .sw-bar.me{background:var(--accent)} .sw-bar.base{background:var(--base)} .sw-bar.under{background:var(--under)}
.tablewrap{overflow-x:auto;margin:10px 0 14px;border:1px solid var(--rule);border-radius:8px;background:var(--raise)}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:7px 10px;text-align:left;border-bottom:1px solid var(--grid);vertical-align:top}
th{font-weight:600;color:var(--ink-2);background:var(--surface);position:sticky;top:0;white-space:nowrap;font-size:12px}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
tbody tr:last-child td{border-bottom:0}
table.compact th,table.compact td{padding:5px 9px}
details.data{margin:4px 0 2px;font-size:13px}
details.data summary{cursor:pointer;color:var(--accent-ink);font-size:12.5px;padding:4px 0}
.chip{display:inline-block;padding:1px 7px;border-radius:99px;font-size:11.5px;background:var(--chip);color:var(--ink-2);white-space:nowrap}
.chip.hi{background:var(--tint);color:var(--accent-ink);font-weight:600}
.chip.lo{background:var(--under-tint);color:var(--under);font-weight:600}
.pill{display:inline-block;min-width:22px;text-align:center;padding:0 6px;border-radius:99px;background:var(--chip);font-variant-numeric:tabular-nums;font-weight:600}
.pill.n4{background:var(--accent);color:#fff} .pill.n3{background:var(--tint);color:var(--accent-ink)}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;max-width:880px}
.mini{background:var(--raise);border:1px solid var(--rule);border-radius:8px;padding:12px 14px}
.mini h4{margin:0 0 6px;font:600 14px var(--body)}
.mini p{font-size:13.5px;margin:0 0 6px}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.controls input{font:14px var(--body);padding:7px 10px;border:1px solid var(--rule);border-radius:6px;background:var(--raise);color:var(--ink);min-width:0;flex:1 1 220px;max-width:340px}
.controls button{font:13px var(--body);padding:6px 11px;border-radius:99px;border:1px solid var(--rule);background:var(--raise);color:var(--ink-2);cursor:pointer}
.controls button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
#master th{cursor:pointer;user-select:none}
#master th[aria-sort="ascending"]::after{content:" ▲";font-size:9px} #master th[aria-sort="descending"]::after{content:" ▼";font-size:9px}
#master td:first-child,#master th:first-child{position:sticky;left:0;background:var(--raise);z-index:1}
#master th:first-child{background:var(--surface);z-index:2}
.profile{background:var(--raise);border:1px solid var(--accent);border-radius:10px;padding:18px 20px;max-width:78ch}
.profile p{margin:0 0 10px}
#tip{position:fixed;z-index:50;pointer-events:none;background:var(--raise);color:var(--ink);border:1px solid var(--rule);border-radius:6px;padding:7px 10px;font-size:12.5px;box-shadow:0 4px 18px rgba(0,0,0,.12);max-width:300px}
#tip .tv{font-weight:600;font-variant-numeric:tabular-nums} #tip .tl{color:var(--ink-2)}
footer{margin-top:36px;font-size:12.5px;color:var(--muted);border-top:1px solid var(--rule);padding-top:14px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:900px){.layout{grid-template-columns:1fr}nav.toc{position:static;max-height:none;border:1px solid var(--rule);border-radius:8px;padding:10px;background:var(--raise)}nav.toc ol{grid-template-columns:1fr 1fr}}
@media (max-width:520px){nav.toc ol{grid-template-columns:1fr}.kpi .v{font-size:28px}h2{font-size:27px}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
"""

JS = r"""
(function(){
  const tip=document.getElementById('tip');
  function show(el,x,y){
    const v=el.getAttribute('data-v'), l=el.getAttribute('data-l'); if(v===null)return;
    tip.textContent=''; const a=document.createElement('div'); a.className='tv'; a.textContent=v;
    const b=document.createElement('div'); b.className='tl'; b.textContent=l||''; tip.append(a,b); tip.hidden=false;
    const r=tip.getBoundingClientRect(); let px=x+14, py=y+14;
    if(px+r.width>innerWidth-8) px=x-r.width-14; if(py+r.height>innerHeight-8) py=y-r.height-14;
    tip.style.left=Math.max(8,px)+'px'; tip.style.top=Math.max(8,py)+'px';
  }
  document.addEventListener('pointermove',e=>{const el=e.target.closest&&e.target.closest('[data-v]'); if(!el){tip.hidden=true;return;} show(el,e.clientX,e.clientY);});
  document.addEventListener('focusin',e=>{const el=e.target.closest&&e.target.closest('[data-v]'); if(!el){tip.hidden=true;return;} const r=el.getBoundingClientRect(); show(el,r.left+r.width/2,r.top+r.height/2);});
  document.addEventListener('scroll',()=>{tip.hidden=true},{passive:true});
  // master table: sort + filter
  const t=document.getElementById('master'); if(!t) return;
  const tb=t.tBodies[0], rows=[...tb.rows], q=document.getElementById('q'); let pos='ALL';
  function apply(){const s=(q.value||'').toLowerCase(); let n=0; rows.forEach(r=>{const ok=(pos==='ALL'||r.dataset.pos===pos)&&(!s||r.dataset.s.includes(s)); r.hidden=!ok; if(ok)n++;}); document.getElementById('count').textContent=n+' '+(t.dataset.unit||'players');}
  q.addEventListener('input',apply);
  document.querySelectorAll('[data-posf]').forEach(b=>b.addEventListener('click',()=>{pos=b.dataset.posf; document.querySelectorAll('[data-posf]').forEach(x=>x.setAttribute('aria-pressed',x===b?'true':'false')); apply();}));
  [...t.tHead.rows[0].cells].forEach((th,i)=>th.addEventListener('click',()=>{
    const dir=th.getAttribute('aria-sort')==='descending'?'ascending':'descending';
    [...t.tHead.rows[0].cells].forEach(c=>c.removeAttribute('aria-sort')); th.setAttribute('aria-sort',dir);
    const num=th.classList.contains('num');
    const key=r=>{const c=r.cells[i]; const v=c.dataset.k!==undefined?c.dataset.k:c.textContent; return num?(v===''?-Infinity:parseFloat(v)):v.toLowerCase();};
    rows.sort((a,b)=>{const x=key(a),y=key(b); return (x>y?1:x<y?-1:0)*(dir==='ascending'?1:-1);}); rows.forEach(r=>tb.appendChild(r));
  }));
  apply();
})();
"""
