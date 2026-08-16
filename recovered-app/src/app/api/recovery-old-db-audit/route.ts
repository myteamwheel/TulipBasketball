import { NextResponse } from "next/server";
import { Pool } from "pg";
export const dynamic = "force-dynamic";

type AuditRow = { name:string; present:boolean; host?:string|null; ok?:boolean; db?:string|null; error?:string; counts?:Record<string,number|null>; ranges?:Record<string,{earliest:string|null;latest:string|null}> };

async function audit(name:string, connectionString:string):Promise<AuditRow>{
  let host:string|null=null;
  try{ host=new URL(connectionString).hostname; }catch{}
  const p=new Pool({connectionString,max:1,connectionTimeoutMillis:10000,statement_timeout:12000});
  try{
    const r=await p.query(`select current_database() as db`);
    const tables=await p.query(`select tablename from pg_tables where schemaname='public'`);
    const have=new Set<string>(tables.rows.map((x:any)=>String(x.tablename)));
    const wanted:[string,string,string][]=[
      ["KtcObservation","ktc_observations","observedAt"],
      ["MarketObservation","market_observations","observedAt"],
      ["RosterSnapshot","roster_snapshots","observedAt"],
      ["RefreshRun","refresh_runs","startedAt"],
      ["Transaction","transactions","sleeperCreatedAt"],
      ["Player","players","createdAt"],
    ];
    const counts:Record<string,number|null>={};
    const ranges:Record<string,{earliest:string|null;latest:string|null}>={};
    for(const [table,key,timeCol] of wanted){
      if(!have.has(table)){counts[key]=null;continue;}
      const q=await p.query(`select count(*)::int as n, min("${timeCol}") as earliest, max("${timeCol}") as latest from "${table}"`);
      counts[key]=Number(q.rows[0]?.n??0);
      ranges[key]={earliest:q.rows[0]?.earliest?new Date(q.rows[0].earliest).toISOString():null,latest:q.rows[0]?.latest?new Date(q.rows[0].latest).toISOString():null};
    }
    return {name,present:true,host,ok:true,db:r.rows[0]?.db??null,counts,ranges};
  }catch(e){return {name,present:true,host,ok:false,error:e instanceof Error?e.message:String(e)};}
  finally{await p.end().catch(()=>{});}
}

export async function GET(){
  const names=["DATABASE_URL","DIRECT_URL","POSTGRES_URL","PRISMA_DATABASE_URL","PRISMA_POSTGRES_URL"];
  const out:AuditRow[]=[];
  for(const name of names){
    const url=process.env[name]?.trim();
    if(!url){out.push({name,present:false});continue;}
    out.push(await audit(name,url));
    // Prisma documents that pooled and direct Postgres URLs share credentials;
    // the only connection-string difference is pooled.db.prisma.io -> db.prisma.io.
    // This is a read-only recovery probe and never returns the credentials.
    try{
      const u=new URL(url);
      if(u.hostname==="pooled.db.prisma.io"){
        u.hostname="db.prisma.io";
        out.push(await audit(`${name}_DERIVED_DIRECT`,u.toString()));
      }
    }catch{}
  }
  return NextResponse.json({candidates:out});
}
