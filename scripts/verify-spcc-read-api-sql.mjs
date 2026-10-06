import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
if(!process.env.PGLITE_MODULE)throw new Error('Set PGLITE_MODULE; tests only use local PostgreSQL.');
const {PGlite}=await import(process.env.PGLITE_MODULE),db=new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create table public.accounts(id uuid primary key); grant usage on schema public,auth to anon,authenticated,service_role;');
const sql=readFileSync('supabase/migrations/20261006182947_spcc_readonly_api.sql','utf8');await db.exec(sql);await db.exec(sql);
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
await db.query('insert into auth.users values($1)',[id(1)]);await db.query('insert into accounts values($1)',[id(2)]);
for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);for(const statement of ['select * from spcc_read_api_keys','delete from spcc_read_api_keys','update spcc_read_api_keys set label=label',`insert into spcc_read_api_keys(id) values('${id(9)}')`])await assert.rejects(db.exec(statement),/permission denied/);await db.exec('reset role');}
await db.exec('set role service_role');
const insert=()=>db.query(`insert into spcc_read_api_keys(account_id,created_by,label,key_hash,key_prefix,expires_at) values($1,$2,'Example',$3,'sr_spcc_example',now()+interval '90 days') returning scope`,[id(2),id(1),'a'.repeat(64)]);
assert.equal((await insert()).rows[0].scope,'spcc:read');await assert.rejects(insert(),/unique/);await assert.rejects(db.query("update spcc_read_api_keys set scope='admin'"),/check/);
await assert.rejects(db.query('update spcc_read_api_keys set expires_at=created_at'),/check/);
await db.exec('update spcc_read_api_keys set revoked_at=now()');assert.ok((await db.query('select revoked_at from spcc_read_api_keys')).rows[0].revoked_at);
await db.close();console.log('PASS local PostgreSQL source key schema: repeatable migration, browser/anonymous denial, service-only management, unique hashes, fixed read-only scope, valid expiry and revocation.');
