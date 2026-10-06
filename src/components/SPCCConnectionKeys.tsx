import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
export default function SPCCConnectionKeys({accountId,request}:{accountId:string,request?:(action:string,extra:object)=>Promise<any>}) {
  const [keys,setKeys]=useState<any[]>([]), [secret,setSecret]=useState(''), [label,setLabel]=useState('myScribe'), [consent,setConsent]=useState(false), [busy,setBusy]=useState(false), [message,setMessage]=useState('');
  const call=async(action:string,extra:object={})=>{
    if(request) return request(action,{account_id:accountId,...extra});
    const {data,error}=await supabase.functions.invoke('spcc-read-api/keys',{body:{action,account_id:accountId,...extra}});
    if(error || data?.error) throw new Error(data?.error || 'Connection key management is unavailable. Ask your account administrator.');
    return data;
  };
  useEffect(()=>{let active=true;setSecret('');setConsent(false);setKeys([]);call('list').then(d=>{if(active)setKeys(d.keys)}).catch(e=>{if(active)setMessage(e.message)});return()=>{active=false}},[accountId]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await fn()}catch(e:any){setMessage(e.message)}finally{setBusy(false)}};
  return <section className="space-y-4 text-gray-900 dark:text-gray-100">
    <h2 className="text-xl font-semibold">SPCC connections</h2>
    <p>Create a read-only key for the selected account. It allows facility names, plan links, workflow statuses and recorded dates to be read. It cannot change facilities or plans. Only account or agency administrators can manage these keys.</p>
    <label className="block">Connection name<input className="block border rounded p-2 w-full bg-transparent" value={label} maxLength={80} onChange={e=>setLabel(e.target.value)}/></label>
    <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>I authorize read-only SPCC access to this account for 90 days.</label>
    <button className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50" disabled={busy || !consent || !!secret} onClick={()=>run(async()=>{const d=await call('create',{label,confirm_read_access:true});setSecret(d.key);setKeys(k=>[d.metadata,...k]);setConsent(false)})}>Create read-only key</button>
    {secret && <div className="border rounded p-4 space-y-2"><p>Shown once. Enter this in myScribe → Settings → Survey Route. Do not paste it into a chat or voice conversation.</p><input aria-label="New read-only key" type="password" readOnly value={secret} className="border rounded p-2 w-full bg-transparent"/><button className="border rounded px-3 py-2" onClick={()=>run(async()=>{await navigator.clipboard.writeText(secret);setMessage('Key copied. Paste only in the connection setting.')} )}>Copy key</button><button className="border rounded px-3 py-2 ml-2" onClick={()=>setSecret('')}>Hide key</button></div>}
    {message && <p role="status">{message}</p>}
    <ul className="space-y-3">{keys.map(k=><li key={k.id} className="border rounded p-3"><strong>{k.label}</strong> · {k.key_prefix}… · {k.revoked_at?'Revoked':`Expires ${k.expires_at.slice(0,10)}`}{!k.revoked_at && <button disabled={busy} className="ml-3 bg-red-600 text-white rounded px-3 py-2" onClick={()=>run(async()=>{await call('revoke',{key_id:k.id});setKeys((await call('list')).keys);setSecret('')})}>Revoke key</button>}</li>)}</ul>
    <p className="text-sm">Revoking stops future reads. Copies already imported into another app remain there until disconnected. Keys also stop working if their creator loses account administrator access.</p>
  </section>;
}
