import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App,hasPendingHostRecovery,OriginalRetainedLibraryNotice } from '../src/web/App.tsx';
import { captureBackupIntent,writeStoredBackupIntent } from '../src/web/backup-client.ts';
import { reconnectSession,bootstrapSession } from '../src/web/client.ts';
function storage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
const backupId=randomUUID();
const recovery=captureBackupIntent({kind:'recover',backupId,key:randomUUID(),backupRevision:2,preview:{mode:'recover',backupId,operationId:randomUUID(),previewToken:randomUUID(),expiresAt:9999999999999,manifestHash:'a'.repeat(64),diffHash:'b'.repeat(64),differences:['Recuperar host sintético'],blockers:[]}});

test('reload with a persisted host recovery renders its independent control without requiring catalog or runs',()=>{
  const store=storage();assert.equal(hasPendingHostRecovery(store),false);assert.equal(writeStoredBackupIntent(store,recovery),true);assert.equal(hasPendingHostRecovery(store),true);
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{value:{sessionStorage:store},configurable:true});
  try{const html=renderToStaticMarkup(React.createElement(App));assert.match(html,/Recuperación independiente del host/);assert.match(html,/Abriendo el control de recuperación/);assert.doesNotMatch(html,/El reparto|Preparar representación|Cargar biblioteca recuperada|Confirmo que quiero consultar datos internos/);}
  finally{if(previous===undefined)Reflect.deleteProperty(globalThis,'window');else Object.defineProperty(globalThis,'window',previous);}
  writeStoredBackupIntent(store,captureBackupIntent({kind:'create',backupId,key:randomUUID()}));assert.equal(hasPendingHostRecovery(store),false);
  store.setItem('personajes:backup-restore-intent','{');assert.equal(hasPendingHostRecovery(store),false);
});

test('reconnect obtains a fresh shell nonce, shares concurrent recovery and never repeats a restore mutation',async()=>{
  const originalFetch=globalThis.fetch;const originalParser=Object.getOwnPropertyDescriptor(globalThis,'DOMParser');
  const calls:Array<{path:string;init:RequestInit|undefined}>=[];const selectors:string[]=[];
  class Parser {parseFromString(html:string,mime:string){assert.equal(mime,'text/html');return {querySelector(selector:string){selectors.push(selector);const nonce=html.match(/content="([^"]+)"/)?.[1];return nonce===undefined?null:{getAttribute(name:string){assert.equal(name,'content');return nonce;}};}};}}
  Object.defineProperty(globalThis,'DOMParser',{value:Parser,configurable:true});
  globalThis.fetch=async(path,init)=>{calls.push({path:String(path),init});if(String(path)==='/')return new Response('<html><head><meta name="personajes-bootstrap" content="fresh-recovery-nonce"></head></html>');assert.equal(String(path),'/api/v1/session');return new Response(JSON.stringify({csrfToken:'fresh_csrf_token_012345678901234567890123456789',expiresAt:'2026-10-17T00:00:00Z'}));};
  try{
    const first=reconnectSession();const second=reconnectSession();assert.equal(first,second);const session=await first;assert.equal(session.csrfToken,'fresh_csrf_token_012345678901234567890123456789');assert.equal(await bootstrapSession(),session);
    assert.deepEqual(calls.map(call=>call.path),['/','/api/v1/session']);assert.equal(calls[0]?.init?.cache,'no-store');assert.equal(calls[0]?.init?.credentials,'same-origin');assert.equal(calls[1]?.init?.method,'POST');assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)),{bootNonce:'fresh-recovery-nonce'});assert.deepEqual(selectors,['meta[name="personajes-bootstrap"]']);
    // A missing new nonce cannot reuse the document's previous authority or retry restore.
    globalThis.fetch=async(path,init)=>{calls.push({path:String(path),init});return new Response('<html><head></head></html>');};
    await assert.rejects(reconnectSession(),/sesión local nueva/);assert.equal(calls.length,3);assert.equal(calls[2]?.path,'/');
  }finally{globalThis.fetch=originalFetch;if(originalParser===undefined)Reflect.deleteProperty(globalThis,'DOMParser');else Object.defineProperty(globalThis,'DOMParser',originalParser);}
});


test('returning to the original library is explicit and distinct from a verified recovery',()=>{
  const html=renderToStaticMarkup(React.createElement(OriginalRetainedLibraryNotice,{refreshing:false,error:null,onReload:()=>{throw new Error('Rendering must not reload');}}));
  assert.match(html,/La recuperación se canceló y se conservó el host original/);assert.match(html,/Cargar biblioteca del host original/);assert.match(html,/borradores abiertos/);assert.doesNotMatch(html,/recuperado|verificad|biblioteca recuperada|disabled/);
  const failed=renderToStaticMarkup(React.createElement(OriginalRetainedLibraryNotice,{refreshing:true,error:'El host todavía no está disponible.',onReload:()=>{}}));assert.match(failed,/disabled=""/);assert.match(failed,/El host todavía no está disponible/);
});
