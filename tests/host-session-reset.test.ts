import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reconnectSession } from '../src/web/client.ts';
import { HOST_SESSION_RESET_EVENT,subscribeToHostSessionReset } from '../src/web/host-session-reset.ts';

test('successful host reconnection invalidates every mounted authority subscriber once; failed reconnect and unmounted panels do not',async()=>{
  const originalFetch=globalThis.fetch;const descriptors=new Map(['window','DOMParser'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const host=new EventTarget();const states={inspector:true,interlocutor:true,director:true,circumstances:true};const calls:string[]=[];
  const unsubscribe=Object.keys(states).map(key=>subscribeToHostSessionReset(()=>{calls.push(key);Reflect.set(states,key,false);},host));
  Object.defineProperty(globalThis,'window',{value:host,configurable:true});
  Object.defineProperty(globalThis,'DOMParser',{value:class{parseFromString(){return {querySelector(){return {getAttribute(){return 'fresh_recovery_nonce_01234567890123456789';}};}};}},configurable:true});
  let valid=true;globalThis.fetch=async path=>String(path)==='/'?new Response('<html></html>',{status:valid?200:503}):new Response(JSON.stringify({csrfToken:'fresh_csrf_token_01234567890123456789',expiresAt:'2026-10-17T00:00:00Z'}));
  try{
    const first=reconnectSession();const second=reconnectSession();assert.equal(first,second);await first;
    assert.deepEqual(states,{inspector:false,interlocutor:false,director:false,circumstances:false});assert.deepEqual(calls,['inspector','interlocutor','director','circumstances']);
    for(const remove of unsubscribe)remove();host.dispatchEvent(new Event(HOST_SESSION_RESET_EVENT));assert.equal(calls.length,4);
    valid=false;await assert.rejects(reconnectSession(),/sesión local/);assert.equal(calls.length,4);
  }finally{for(const remove of unsubscribe)remove();globalThis.fetch=originalFetch;for(const [key,descriptor] of descriptors){if(descriptor===undefined)Reflect.deleteProperty(globalThis,key);else Object.defineProperty(globalThis,key,descriptor);}}
});
