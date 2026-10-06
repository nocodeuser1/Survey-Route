import React from 'react';
import {createRoot} from 'react-dom/client';
import SPCCConnectionKeys from '../src/components/SPCCConnectionKeys';
import '../src/index.css';
const dark=new URLSearchParams(location.search).get('theme')==='dark';document.documentElement.classList.toggle('dark',dark);
let keys=[{id:'synthetic-id',label:'Example myScribe',key_prefix:'sr_spcc_example',expires_at:'2027-01-04T00:00:00Z',revoked_at:null as string|null}];
const request=async(action:string)=>{if(action==='list')return {keys};if(action==='revoke'){keys=keys.map(k=>({...k,revoked_at:new Date().toISOString()}));return {revoked:true}}if(action==='create'){const metadata={...keys[0],id:'new',revoked_at:null};keys=[metadata,...keys];return {key:'sr_spcc_'+'a'.repeat(64),metadata}}throw new Error('Unsupported fixture')};
createRoot(document.getElementById('root')!).render(<main className="max-w-3xl mx-auto p-5 bg-white dark:bg-gray-900 min-h-screen"><SPCCConnectionKeys accountId="synthetic-account" request={request}/></main>);
