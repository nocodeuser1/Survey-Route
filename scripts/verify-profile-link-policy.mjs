import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to a local @electric-sql/pglite module. No live database is used.')
const { PGlite } = await import(process.env.PGLITE_MODULE)
const db = new PGlite()
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
await db.exec(`
create role authenticated; create role anon; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',current_setting('request.jwt.claim.email',true)) $$;
create table users(id uuid primary key default gen_random_uuid(),auth_user_id uuid unique,email text unique,full_name text,is_agency_owner boolean default false);
create table account_users(account_id uuid,user_id uuid references users(id),role text,invited_by uuid,joined_at timestamptz,unique(account_id,user_id));
create table user_invitations(id uuid primary key default gen_random_uuid(),email text,account_id uuid,role text,invited_by uuid,token text,status text,expires_at timestamptz);
alter table users enable row level security;
alter table account_users enable row level security;
alter table user_invitations enable row level security;
grant usage on schema public,auth to authenticated,anon;
grant all on users,account_users,user_invitations to authenticated,anon;
create policy "Users can view own record" on users for select to authenticated using(auth_user_id=auth.uid());
create policy "Users can insert themselves" on users for insert to authenticated with check(auth_user_id=auth.uid());
create policy "Users can update themselves" on users for update to authenticated using(auth_user_id=auth.uid()) with check(auth_user_id=auth.uid());
`)
await db.exec(readFileSync('supabase/migrations/20251204071946_allow_linking_auth_to_existing_users.sql','utf8'))
// Exercise the actual existing acceptance function, not a test reimplementation.
const invitationMigration = readFileSync('supabase/migrations/20260826000000_secure_account_invitation_flow.sql','utf8')
const start = invitationMigration.indexOf('CREATE OR REPLACE FUNCTION public.accept_user_invitation(')
const endMarker = 'GRANT EXECUTE ON FUNCTION public.accept_user_invitation(text) TO authenticated;'
const end = invitationMigration.indexOf(endMarker,start) + endMarker.length
assert.ok(start > 0 && end > start)
await db.exec(invitationMigration.slice(start,end))
const rows = async (sql, params = []) => (await db.query(sql,params)).rows
const asUser = async (n,email) => {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.email',$2,false)",[id(n),email])
  await db.exec('set role authenticated')
}
const adminRows = async sql => { await db.exec('reset role'); return rows(sql) }
const accept = token => db.query('select accept_user_invitation($1) as result',[token])
await db.query('insert into users(id,email,full_name) values($1,$2,$3)',[id(10),'intended@example.invalid','Existing Person'])
await db.query('insert into account_users values($1,$2,$3,null,now())',[id(20),id(10),'account_admin'])
const before = await rows('select * from account_users')
await asUser(1,'stranger@example.invalid')
assert.equal((await rows('select count(*)::int as n from users'))[0].n,0)
assert.equal((await db.query('update users set auth_user_id=auth.uid() where id=$1',[id(10)])).affectedRows,0)
await db.exec('begin')
assert.equal((await db.query('update users set auth_user_id=auth.uid()')).affectedRows,1)
await db.exec('rollback')
await db.exec('reset role')
const repair = readFileSync('supabase/migrations/20261006192353_restrict_unlinked_profile_claim.sql','utf8')
await db.exec(repair)
await db.exec(repair)
assert.deepEqual(await rows('select * from account_users'),before)
assert.equal((await rows('select auth_user_id from users'))[0].auth_user_id,null)
await asUser(1,'stranger@example.invalid')
assert.equal((await db.query('update users set auth_user_id=auth.uid()')).affectedRows,0)
assert.equal((await db.query('update users set auth_user_id=auth.uid() where id=$1',[id(10)])).affectedRows,0)
await db.exec('reset role')
for (const [token,status,expiry] of [['valid','pending','1 day'],['expired','pending','-1 day'],['used','accepted','1 day']]) {
  await db.query("insert into user_invitations(email,account_id,role,token,status,expires_at) values('intended@example.invalid',$1,'user',$2,$3,now()+$4::interval)",[id(21),token,status,expiry])
}
await asUser(1,'stranger@example.invalid')
await assert.rejects(accept('valid'),/email address/)
await asUser(2,'INTENDED@example.invalid')
assert.equal((await db.query('update users set auth_user_id=auth.uid()')).affectedRows,0)
await assert.rejects(accept('expired'),/expired/)
await assert.rejects(accept('used'),/already used/)
await assert.rejects(accept('missing'),/invalid/)
assert.equal((await accept('valid')).rows[0].result.success,true)
await assert.rejects(accept('valid'),/already used/)
assert.equal((await rows('select id,auth_user_id from users'))[0].id,id(10))
assert.equal((await rows('select id,auth_user_id from users'))[0].auth_user_id,id(2))
assert.equal((await db.query("update users set full_name='Updated Own Name' where id=$1",[id(10)])).affectedRows,1)
assert.deepEqual(await adminRows(`select * from account_users where account_id='${id(20)}'`),before)
assert.equal((await rows('select count(*)::int as n from users'))[0].n,1)
assert.equal((await rows('select role from account_users where account_id=$1',[id(21)]))[0].role,'user')
// Existing signed-in members accepting another invitation keep profile identity
// and all prior account memberships; a fresh invitee still gets a new profile.
await db.query("insert into user_invitations(email,account_id,role,token,status,expires_at) values('intended@example.invalid',$1,'user','existing','pending',now()+interval '1 day'),('fresh@example.invalid',$1,'user','fresh','pending',now()+interval '1 day')",[id(22)])
await asUser(2,'intended@example.invalid')
assert.equal((await accept('existing')).rows[0].result.success,true)
await asUser(3,'fresh@example.invalid')
assert.equal((await accept('fresh')).rows[0].result.success,true)
assert.equal((await rows('select auth_user_id from users'))[0].auth_user_id,id(3))
await db.exec('reset role; set role anon')
await assert.rejects(accept('fresh'),/permission denied/)
assert.equal((await db.query('update users set auth_user_id=auth.uid()')).affectedRows,0)
await db.exec('reset role')
assert.deepEqual(await rows(`select * from account_users where account_id='${id(20)}'`),before)
assert.match(readFileSync('src/pages/AcceptInvitePage.tsx','utf8'), /'accept_user_invitation'/)
await db.close()
console.log('PASS local profile linking: pre-fix unfiltered claim reproduced; repair idempotent; direct claims blocked; valid email-bound invitation links original profile; wrong/expired/reused token denied; old memberships preserved; existing and fresh invitees work. No live writes.')
