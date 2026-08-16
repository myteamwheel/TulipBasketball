import { NextResponse } from "next/server";
import { Pool } from "pg";
export const dynamic = "force-dynamic";
export async function GET(){
 const names=["DATABASE_URL","DIRECT_URL","POSTGRES_URL","PRISMA_DATABASE_URL","PRISMA_POSTGRES_URL"]; const out:any[]=[];
 for(const name of names){const url=process.env[name]?.trim();if(!url){out.push({name,present:false});continue;} const p=new Pool({connectionString:url,max:1,connectionTimeoutMillis:8000});try{const r=await p.query(`select current_database() as db, now() as now`);out.push({name,present:true,ok:true,db:r.rows[0]?.db??null});}catch(e){out.push({name,present:true,ok:false,error:e instanceof Error?e.message:String(e)});}finally{await p.end().catch(()=>{});}}
 return NextResponse.json({candidates:out});
}
