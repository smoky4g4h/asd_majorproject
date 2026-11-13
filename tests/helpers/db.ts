import {PGlite,type Transaction} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';

// A real local Postgres engine with a deliberately minimal Supabase Auth boundary.
// This does not simulate hosted Auth/Storage/Realtime transport or verify their configuration.
export async function createPolicyDatabase(){
 const db=new PGlite();
 await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email character varying(255),raw_user_meta_data jsonb not null default '{}',created_at timestamptz not null default now());
  create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),status text);
  create table auth.identities(user_id uuid not null references auth.users(id),provider text not null,primary key(user_id,provider));
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
  grant usage on schema auth,public to anon,authenticated,service_role;
  grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role;
 `);
 const directory=resolve(process.cwd(),'supabase/migrations');
 const migrations=(await readdir(directory)).filter(name=>/^\d+_.+\.sql$/.test(name)).sort();
 if(!migrations.some(name=>name==='202611070001_core.sql'))throw new Error('The core policy migration is required.');
 try{for(const name of migrations)await db.exec(await readFile(resolve(directory,name),'utf8'))}
 catch(error){await db.close();throw error}
 return {db,migrations};
}

export type TestActor={id:string;aal?:'aal1'|'aal2';email?:string;metadata?:Record<string,unknown>;methods?:string[]};
export async function setActor(tx:Transaction,actor:TestActor|null){
 await tx.exec(actor?'set local role authenticated':'set local role anon');
 await tx.exec('set local row_security = on');
 await tx.query("select set_config('request.jwt.claims',$1,true)",[
  JSON.stringify(actor?{sub:actor.id,email:actor.email||`fixture-${actor.id.slice(-2)}@securemeet.example`,role:'authenticated',amr:(actor.methods??['oauth']).map(method=>({method,timestamp:1})),aal:actor.aal||'aal1',user_metadata:actor.metadata||{}}:{role:'anon'}),
 ]);
}
export async function asActor<T>(db:PGlite,actor:TestActor|null,body:(tx:Transaction)=>Promise<T>):Promise<T>{
 return db.transaction(async tx=>{
  await setActor(tx,actor);
  const result=await body(tx);
  // Each test can exercise real writes without leaking them into another test.
  await tx.rollback();
  return result;
 });
}

export const uuid=(value:number)=>`00000000-0000-4000-8000-${String(value).padStart(12,'0')}`;
