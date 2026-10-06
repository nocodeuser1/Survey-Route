// Deterministic in-memory PostgREST double: no credentials/network. Security tests
// exercise server authority and actual export/preview/import control flow.
export function fakeDb(tables={},user={}){
  const db={tables:structuredClone(tables),calls:[],auth:{getUser:async()=>({data:{user},error:null}),admin:{getUserById:async()=>({data:{user},error:null})}}}
  db.from=table=>{
    let filters=[],columns='*',method='select',values,one=false,limit=Infinity,order=null,ascending=true
    const q={select(c='*'){columns=c;return q},eq(k,v){filters.push(r=>r[k]===v);return q},gt(k,v){filters.push(r=>r[k]>v);return q},in(k,vs){filters.push(r=>vs.includes(r[k]));return q},limit(n){limit=n;return q},order(k,opts){order=k;ascending=opts?.ascending!==false;return q},maybeSingle(){one=true;return q},single(){one=true;return q},insert(v){method='insert';values=v;return q},update(v){method='update';values=v;return q},delete(){method='delete';return q},then(resolve,reject){try{
      db.calls.push({table,method,columns});let rows=(db.tables[table]||[]).filter(r=>filters.every(f=>f(r)))
      if(method==='insert'){rows=[{id:crypto.randomUUID(),created_at:new Date().toISOString(),current_snapshot_id:null,...values}];(db.tables[table]||=[]).push(...rows)}
      if(method==='update')rows.forEach(r=>Object.assign(r,values))
      if(method==='delete')db.tables[table]=(db.tables[table]||[]).filter(r=>!rows.includes(r))
      if(order)rows.sort((a,b)=>String(a[order]).localeCompare(String(b[order]))*(ascending?1:-1))
      rows=rows.slice(0,limit).map(r=>columns==='*'?structuredClone(r):Object.fromEntries(columns.split(',').map(k=>[k,r[k]])))
      return Promise.resolve({data:one?rows[0] || null:rows,error:null}).then(resolve,reject)
    }catch(e){return Promise.reject(e).then(resolve,reject)}}};return q
  }
  db.rpc=async(name,p)=>{db.calls.push({rpc:name});const c=db.tables.survey_route_connections.find(c=>c.id===p.p_connection && c.user_id===p.p_user)
    if(!c || (c.current_snapshot_id || null)!==(p.p_expected || null))return {error:{message:'conflict'}}
    if(name==='restore_survey_route_snapshot'){const s=db.tables.survey_route_snapshots.find(s=>s.id===c.current_snapshot_id);c.current_snapshot_id=s.previous_snapshot_id;return {data:c.current_snapshot_id,error:null}}
    const s={id:crypto.randomUUID(),connection_id:c.id,previous_snapshot_id:c.current_snapshot_id,imported_at:new Date().toISOString(),content_hash:p.p_hash,observed_at:p.p_observed,records:p.p_records};(db.tables.survey_route_snapshots||=[]).push(s);c.current_snapshot_id=s.id;return {data:s.id,error:null}
  }
  return db
}
