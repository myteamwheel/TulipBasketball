import { NextResponse } from "next/server";
import { Pool } from "pg";
export const dynamic = "force-dynamic";
export async function GET(){
 const url=process.env.RECOVERY_BACKUP_DATABASE_URL?.trim()||process.env.BACKUP_DATABASE_URL?.trim();
 if(!url)return NextResponse.json({configured:false});
 const p=new Pool({connectionString:url,max:1});
 try{
  const q=await p.query(`SELECT "id","createdAt","sourceRefreshRunId","counts" FROM "DashboardBackup" ORDER BY "createdAt" ASC`);
  const rows=q.rows.map((r:any)=>({id:r.id,createdAt:new Date(r.createdAt).toISOString(),sourceRefreshRunId:r.sourceRefreshRunId,counts:r.counts}));
  return NextResponse.json({configured:true,count:rows.length,earliest:rows[0]??null,latest:rows.at(-1)??null,rows});
 }catch(e){return NextResponse.json({configured:true,error:e instanceof Error?e.message:String(e)});}finally{await p.end().catch(()=>{});}
}
