export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const KEY = /^sr_spcc_[a-f0-9]{64}$/;
const META = 'id,account_id,label,key_prefix,scope,created_at,expires_at,revoked_at';
const FACILITY = 'id,account_id,name,status,created_at,first_prod_date,spcc_due_date,spcc_inspection_date,spcc_workflow_status,spcc_workflow_status_overridden,spcc_pe_stamp_date,spcc_plan_url,field_visit_date,recertified_date,company_signature_date';
const PLAN = 'id,facility_id,berm_index,berm_label,workflow_status,workflow_status_overridden,pe_stamp_date,plan_url,created_at,updated_at,field_visit_date,recertified_date,recertification_decision_at,recertification_pdf_generated_at,management_signature_applied_at';
const checked = ({data,error}) => { if(error) throw new Error('Database operation failed'); return data; };
export async function hashKey(key) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2,'0')).join('');
}
export function newKey() { return 'sr_spcc_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), b=>b.toString(16).padStart(2,'0')).join(''); }
// Rechecked for every export: removing the issuer's account authority stops its keys.
export async function canManage(db, authUser, account) {
  if (!authUser?.id || !authUser.email_confirmed_at || (authUser.banned_until && Date.parse(authUser.banned_until)>Date.now())) return false;
  const profile = checked(await db.from('users').select('id').eq('auth_user_id',authUser.id).maybeSingle());
  const agency = checked(await db.from('agencies').select('owner_email').eq('id',account.agency_id).maybeSingle());
  if (agency?.owner_email?.toLowerCase() === authUser.email?.toLowerCase()) return true;
  if (!profile) return false;
  const co = checked(await db.from('agency_co_owners').select('user_id').eq('agency_id',account.agency_id).eq('user_id',profile.id).maybeSingle());
  if (co) return true;
  const member = checked(await db.from('account_users').select('role').eq('account_id',account.id).eq('user_id',profile.id).maybeSingle());
  return member?.role === 'account_admin';
}
export function sourceRecord(f, p = null) {
  const planId = p?.id || null;
  const date = p ? p.pe_stamp_date : f.spcc_pe_stamp_date;
  const hasFile = Boolean(p ? p.plan_url : f.spcc_plan_url);
  return {
    external_id: planId ? `plan:${planId}` : `facility:${f.id}`,
    facility_id:f.id, plan_id:planId, facility_name:f.name,
    facility_status:f.status || 'unknown', berm_label:p?.berm_label || null, berm_index:p?.berm_index || null,
    workflow_status:(p ? p.workflow_status : f.spcc_workflow_status) || 'unknown',
    workflow_status_overridden:Boolean(p ? p.workflow_status_overridden : f.spcc_workflow_status_overridden),
    pe_stamp_status:date ? 'date_recorded' : 'unknown', pe_stamp_date:date || null,
    has_plan_file:hasFile,
    // Authenticated application link only. Never export a public/signed storage URL.
    plan_link:hasFile ? `https://survey-route.com/connected-spcc/${f.id}${planId ? `?plan=${planId}` : ''}` : null,
    dates:{facility_created_at:f.created_at,plan_created_at:p?.created_at || null,plan_updated_at:p?.updated_at || null,
      first_production_date:f.first_prod_date,initial_plan_due_date:f.spcc_due_date,
      inspection_date:f.spcc_inspection_date,field_visit_date:p ? p.field_visit_date : f.field_visit_date,
      recertified_date:p ? p.recertified_date : f.recertified_date,
      company_signature_date:f.company_signature_date,
      management_signature_applied_at:p?.management_signature_applied_at || null,
      recertification_decision_at:p?.recertification_decision_at || null,
      recertification_pdf_generated_at:p?.recertification_pdf_generated_at || null},
    provenance:{system:'Survey Route',table:planId?'spcc_plans':'facilities',id:planId || f.id,account_id:f.account_id},
  };
}
export function makeHandler({db,enabled=true}) {
  return async req => {
    const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type,apikey,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
    if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
    if(!enabled) return reply(503,{error:'SPCC connection is not enabled yet.'});
    try {
      const url = new URL(req.url);
      const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i,'');
      if(url.pathname.endsWith('/export')) {
        if(req.method!=='GET') return reply(405,{error:'Read-only endpoint'});
        if(!KEY.test(token)) return reply(401,{error:'Valid read-only key required'});
        const key=checked(await db.from('spcc_read_api_keys').select('id,account_id,created_by,expires_at,revoked_at,scope').eq('key_hash',await hashKey(token)).maybeSingle());
        if(!key || key.revoked_at || Date.parse(key.expires_at)<=Date.now() || key.scope!=='spcc:read') return reply(401,{error:'Key expired or revoked'});
        const account=checked(await db.from('accounts').select('id,agency_id,account_name,company_name').eq('id',key.account_id).maybeSingle());
        const {data:issuer,error}=await db.auth.admin.getUserById(key.created_by);
        if(error || !account || !await canManage(db,issuer?.user,account)) return reply(403,{error:'Key issuer no longer has account authority'});
        const after=url.searchParams.get('after');
        if(after && !UUID.test(after)) return reply(400,{error:'Invalid cursor'});
        let q=db.from('facilities').select(FACILITY).eq('account_id',account.id).order('id').limit(100);
        if(after) q=q.gt('id',after);
        const facilities=checked(await q) || [];
        const plans=facilities.length ? checked(await db.from('spcc_plans').select(PLAN).in('facility_id',facilities.map(f=>f.id)).order('id').limit(1000)) || [] : [];
        if(plans.length>=1000) return reply(409,{error:'Plan page exceeds export limit; no partial page returned'});
        const records=facilities.flatMap(f=>{ const list=plans.filter(p=>p.facility_id===f.id); return list.length?list.map(p=>sourceRecord(f,p)):[sourceRecord(f)]; });
        return reply(200,{version:1,scope:'spcc:read',key_id:key.id,account:{id:account.id,name:account.company_name || account.account_name},observed_at:new Date().toISOString(),facility_count:facilities.length,records,next_cursor:facilities.length===100?facilities.at(-1).id:null});
      }
      if(!url.pathname.endsWith('/keys') || req.method!=='POST') return reply(404,{error:'Not found'});
      const {data:auth,error}=await db.auth.getUser(token);
      if(error || !auth?.user) return reply(401,{error:'Sign in to manage keys'});
      const raw=await req.text();
      if(raw.length>4096) return reply(413,{error:'Request too large'});
      const body=JSON.parse(raw);
      if(!UUID.test(body.account_id || '')) return reply(400,{error:'Select an account'});
      const account=checked(await db.from('accounts').select('id,agency_id').eq('id',body.account_id).maybeSingle());
      if(!account || !await canManage(db,auth.user,account)) return reply(403,{error:'Account administrator access required'});
      if(body.action==='list') return reply(200,{keys:checked(await db.from('spcc_read_api_keys').select(META).eq('account_id',account.id).order('created_at',{ascending:false}).limit(100))});
      if(body.action==='revoke' && UUID.test(body.key_id || '')) {
        checked(await db.from('spcc_read_api_keys').update({revoked_at:new Date().toISOString()}).eq('account_id',account.id).eq('id',body.key_id));
        return reply(200,{revoked:true});
      }
      if(body.action!=='create' || body.confirm_read_access!==true) return reply(400,{error:'Confirm read-only account access before creating a key'});
      const label=String(body.label || '').trim();
      if(!label || label.length>80) return reply(400,{error:'Name the connection (1–80 characters)'});
      const key=newKey();
      const saved=checked(await db.from('spcc_read_api_keys').insert({account_id:account.id,created_by:auth.user.id,label,scope:'spcc:read',key_hash:await hashKey(key),key_prefix:key.slice(0,16),expires_at:new Date(Date.now()+90*86400000).toISOString()}).select(META).single());
      return reply(201,{key,metadata:saved});
    } catch { return reply(500,{error:'Could not complete the SPCC request. No source facilities or plans were changed.'}); }
  };
}
