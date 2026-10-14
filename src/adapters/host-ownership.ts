import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';

const LOCK_NAME = 'host-ownership.json';
const OPERATION_NAME = 'host-ownership.operation';
const MAX_LOCK_BYTES = 2_048;
const OwnershipRecordSchema = z.strictObject({
  kind: z.literal('host-ownership'),
  schemaVersion: z.literal(1),
  nonce: z.string().uuid(),
  pid: z.number().int().positive(),
  processStartedAt: z.string().datetime(),
});
type OwnershipRecord = z.infer<typeof OwnershipRecordSchema>;
const OperationRecordSchema = z.strictObject({
  kind: z.literal('host-ownership-operation'),
  schemaVersion: z.literal(1),
  nonce: z.string().uuid(),
  pid: z.number().int().positive(),
  processStartedAt: z.string().datetime(),
});
const OwnershipFailureDataSchema = z.object({
  kind: z.literal('host-ownership-failure'),
  code: z.enum(['ROOT_INVALID', 'ALREADY_OWNED', 'OPERATION_BUSY', 'LOCK_INVALID', 'LOCK_CHANGED', 'PROCESS_ACTIVE', 'PROCESS_AMBIGUOUS']),
}).passthrough();
type OwnershipFailureCode = z.infer<typeof OwnershipFailureDataSchema>['code'];

function failure(input: { code: OwnershipFailureCode; message: string }) {
  return Object.assign(new Error(input.message), OwnershipFailureDataSchema.parse({ kind: 'host-ownership-failure', code: input.code }));
}

export function isHostOwnershipFailure(error: unknown): error is Error & z.infer<typeof OwnershipFailureDataSchema> {
  return error instanceof Error && OwnershipFailureDataSchema.safeParse(error).success;
}

function privateRoot(input: { path: string }) {
  if (!isAbsolute(input.path)) throw failure({ code: 'ROOT_INVALID', message: 'El directorio privado requiere una ruta absoluta.' });
  mkdirSync(input.path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(input.path);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (!stat.isDirectory() || stat.isSymbolicLink() || (currentUid !== undefined && stat.uid !== currentUid)) {
    throw failure({ code: 'ROOT_INVALID', message: 'El directorio privado debe pertenecer al usuario actual y no ser un enlace simbólico.' });
  }
  chmodSync(input.path, 0o700);
  return realpathSync(input.path);
}

function writeAll(input: { descriptor: number; bytes: Buffer }): void {
  let offset = 0;
  while (offset < input.bytes.length) {
    const written = writeSync(input.descriptor, input.bytes, offset, input.bytes.length - offset);
    if (written <= 0) throw new Error('No se pudo completar la escritura de ownership');
    offset += written;
  }
}

/**
 * A short, fail-closed gate serializes acquire/release/recover/inspect across
 * local processes. Node's portable fs API has no compare-and-unlink primitive;
 * without this gate a second stale recovery could unlink a newly acquired lock.
 * A process crash while holding the gate leaves it for explicit operator review.
 */
function withOperationGate<T>(input: { root: string; operation: () => T }): T {
  const releaseExternal=acquireExternalDirectoryOperation(input.root);
  try{return withInternalOperationGate(input);}finally{releaseExternal();}
}

/** Parent-level gate survives an atomic exchange of the private directory. All host
 * ownership operations cooperate with it; a stale gate requires explicit inspection. */
function acquireExternalDirectoryOperation(root:string){
  const parent=dirname(root);
  if(realpathSync(parent)!==parent)throw failure({code:'ROOT_INVALID',message:'El padre del directorio debe ser canónico.'});
  const path=join(parent,`.${basename(root)}.personajes-host-operation`);
  let fd:number;
  try{fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch{throw failure({code:'OPERATION_BUSY',message:'Hay una operación externa del directorio activa o pendiente de revisión.'});}
  const record=OperationRecordSchema.parse({kind:'host-ownership-operation',schemaVersion:1,nonce:randomUUID(),pid:process.pid,processStartedAt:new Date(Date.now()-process.uptime()*1000).toISOString()});
  const bytes=Buffer.from(JSON.stringify(record));
  try{writeAll({descriptor:fd,bytes});fsyncSync(fd);}catch(error){closeSync(fd);throw error;}
  let released=false;
  return ()=>{
    if(released)return;
    try{const opened=fstatSync(fd);const current=lstatSync(path);if(!current.isFile()||current.isSymbolicLink()||current.dev!==opened.dev||current.ino!==opened.ino)throw failure({code:'LOCK_CHANGED',message:'Cambió el gate externo; se conserva para inspección.'});unlinkSync(path);released=true;}finally{closeSync(fd);}
  };
}

/** Restore already owns the stopped host before entering this gate. No root can be
 * acquired by another process while the canonical directory is exchanged. */
export async function withHostDirectoryOperation<T>(input:{privateDataRoot:string;operation:()=>Promise<T>}):Promise<T>{
  const root=privateRoot({path:input.privateDataRoot});const release=acquireExternalDirectoryOperation(root);
  try{return await input.operation();}finally{release();}
}

function withInternalOperationGate<T>(input: { root: string; operation: () => T }): T {
  const gatePath = join(input.root, OPERATION_NAME);
  let descriptor: number;
  try {
    descriptor = openSync(gatePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw failure({ code: 'OPERATION_BUSY', message: 'Hay una operación de ownership activa o pendiente de revisión; no se modifica el registro.' });
    }
    throw error;
  }

  const gate = OperationRecordSchema.parse({
    kind: 'host-ownership-operation', schemaVersion: 1, nonce: randomUUID(), pid: process.pid,
    processStartedAt: new Date(Date.now() - process.uptime() * 1_000).toISOString(),
  });
  try {
    writeAll({ descriptor, bytes: Buffer.from(JSON.stringify(gate), 'utf8') });
    fsyncSync(descriptor);
    return input.operation();
  } finally {
    try {
      const opened = fstatSync(descriptor);
      const current = lstatSync(gatePath);
      if (!current.isFile() || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino) {
        throw failure({ code: 'LOCK_CHANGED', message: 'Cambió el gate de ownership; se conserva para revisión.' });
      }
      unlinkSync(gatePath);
    } finally {
      closeSync(descriptor);
    }
  }
}

function readRecord(input: { lockPath: string }): { record: OwnershipRecord; content: string; dev: number; inode: number } {
  let descriptor: number;
  try {
    descriptor = openSync(input.lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (isHostOwnershipFailure(error)) throw error;
    throw failure({ code: 'LOCK_INVALID', message: 'El registro de ownership necesita revisión; no se elimina automáticamente.' });
  }
  try {
    const stat = fstatSync(descriptor);
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (!stat.isFile() || stat.size > MAX_LOCK_BYTES || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 ||
      (currentUid !== undefined && stat.uid !== currentUid)) throw new Error('Registro inválido');
    const bytes = Buffer.alloc(MAX_LOCK_BYTES + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > MAX_LOCK_BYTES) throw new Error('Registro demasiado grande');
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
    const data: unknown = JSON.parse(content);
    const currentPath = lstatSync(input.lockPath);
    if (!currentPath.isFile() || currentPath.isSymbolicLink() || currentPath.dev !== stat.dev || currentPath.ino !== stat.ino) {
      throw failure({ code: 'LOCK_CHANGED', message: 'Cambió el registro durante la lectura; se conserva para revisión.' });
    }
    return { record: OwnershipRecordSchema.parse(data), content, dev: stat.dev, inode: stat.ino };
  } catch (error) {
    if (isHostOwnershipFailure(error)) throw error;
    throw failure({ code: 'LOCK_INVALID', message: 'El registro de ownership necesita revisión; no se elimina automáticamente.' });
  } finally {
    closeSync(descriptor);
  }
}

function removeMatchingRecord(input: { lockPath: string; nonce: string; content: string; dev: number; inode: number }): void {
  const current = readRecord({ lockPath: input.lockPath });
  if (current.record.nonce !== input.nonce || current.content !== input.content || current.dev !== input.dev || current.inode !== input.inode) {
    throw failure({ code: 'LOCK_CHANGED', message: 'Cambió el dueño del directorio; se conserva su registro.' });
  }
  unlinkSync(input.lockPath);
}

/** Acquire before opening the journal or workers. Age never authorizes recovery. */
export function acquireHostOwnership(input: { privateDataRoot: string }) {
  const root = privateRoot({ path: input.privateDataRoot });
  return withOperationGate({ root, operation: () => {
    const lockPath = join(root, LOCK_NAME);
    const record = OwnershipRecordSchema.parse({
      kind: 'host-ownership', schemaVersion: 1, nonce: randomUUID(), pid: process.pid,
      processStartedAt: new Date(Date.now() - process.uptime() * 1_000).toISOString(),
    });
    let descriptor: number;
    try {
      descriptor = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        throw failure({ code: 'ALREADY_OWNED', message: 'El directorio privado ya tiene un host registrado. Revisar diagnóstico o recuperar explícitamente.' });
      }
      throw error;
    }
    // A partial lock after an I/O failure remains conservative: no second writer starts.
    try {
      writeAll({ descriptor, bytes: Buffer.from(JSON.stringify(record), 'utf8') });
      fsyncSync(descriptor);
    } finally { closeSync(descriptor); }
    const stored = readRecord({ lockPath });
    let released = false;
    return Object.freeze({
      privateDataRoot: root,
      /** Stable for the lifetime of this exclusive host; journals use it to recover owned jobs. */
      ownerToken: record.nonce,
      release(): void {
        if (released) return;
        withOperationGate({ root, operation: () => removeMatchingRecord({
          lockPath, nonce: record.nonce, content: stored.content, dev: stored.dev, inode: stored.inode,
        }) });
        released = true;
      },
    });
  } });
}

export function inspectHostOwnership(input: { privateDataRoot: string }) {
  const root = privateRoot({ path: input.privateDataRoot });
  return withOperationGate({ root, operation: () => {
    const { record } = readRecord({ lockPath: join(root, LOCK_NAME) });
    return Object.freeze(record);
  } });
}

/** A zombie has already exited and cannot retain a writable journal or session FD.
 * Both proc records must agree on PID/state; opaque start ticks distinguish reuse. */
export function parseLinuxZombieEvidence(input:{pid:number;status:unknown;stat:unknown}):{kind:'zombie';startTicks:string}|{kind:'alive'}|{kind:'ambiguous'}{
  if(typeof input.status!=='string'||typeof input.stat!=='string')return {kind:'ambiguous'};
  const pidLine=/^Pid:\s+(\d+)\s*$/m.exec(input.status);
  const stateLine=/^State:\s+([A-Z])(?:\s|\()/m.exec(input.status);
  const close=input.stat.lastIndexOf(')');const prefix=/^(\d+) \(/.exec(input.stat);
  if(!pidLine||Number(pidLine[1])!==input.pid||!stateLine||!prefix||Number(prefix[1])!==input.pid||close<0)return {kind:'ambiguous'};
  const fields=input.stat.slice(close+1).trim().split(/\s+/);
  const startTicks=fields[19];
  if(!startTicks||!/^\d+$/.test(startTicks)||fields[0]!==stateLine[1])return {kind:'ambiguous'};
  return stateLine[1]==='Z'?{kind:'zombie',startTicks}:{kind:'alive'};
}

function linuxZombieEvidence(pid:number){
  if(process.platform!=='linux')return {kind:'ambiguous'} satisfies {kind:'ambiguous'};
  try{return parseLinuxZombieEvidence({pid,status:readFileSync(`/proc/${pid}/status`,'utf8'),stat:readFileSync(`/proc/${pid}/stat`,'utf8')});}
  catch{return {kind:'ambiguous'} satisfies {kind:'ambiguous'};}
}

/** Explicit operator recovery. A live or ambiguous PID is never overridden. */
export function recoverHostOwnership(input: { privateDataRoot: string; expectedNonce: string; operatorConfirmed: true }): void {
  z.strictObject({ expectedNonce: z.string().uuid(), operatorConfirmed: z.literal(true) }).parse({
    expectedNonce: input.expectedNonce, operatorConfirmed: input.operatorConfirmed,
  });
  const root = privateRoot({ path: input.privateDataRoot });
  return withOperationGate({ root, operation: () => {
    const lockPath = join(root, LOCK_NAME);
    const stored = readRecord({ lockPath });
    if (stored.record.nonce !== input.expectedNonce) {
      throw failure({ code: 'LOCK_CHANGED', message: 'El diagnóstico ya no identifica el mismo registro.' });
    }
    try {
      process.kill(stored.record.pid, 0);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
        removeMatchingRecord({ lockPath, nonce: input.expectedNonce, content: stored.content, dev: stored.dev, inode: stored.inode });
        return;
      }
      throw failure({ code: 'PROCESS_AMBIGUOUS', message: 'No se puede verificar la ausencia del proceso. Se conserva ownership.' });
    }
    // kill(pid,0) succeeds for Linux zombies. Check twice inside both operation
    // gates and retain the record on incomplete evidence, disagreement or PID reuse.
    const first=linuxZombieEvidence(stored.record.pid);
    if(first.kind==='zombie'){
      const second=linuxZombieEvidence(stored.record.pid);
      if(second.kind==='zombie'&&second.startTicks===first.startTicks){
        removeMatchingRecord({lockPath,nonce:input.expectedNonce,content:stored.content,dev:stored.dev,inode:stored.inode});return;
      }
      throw failure({code:'PROCESS_AMBIGUOUS',message:'Cambió la evidencia del proceso; se conserva ownership.'});
    }
    if(process.platform==='linux'&&first.kind==='ambiguous')throw failure({code:'PROCESS_AMBIGUOUS',message:'No se puede comprobar el estado del proceso; se conserva ownership.'});
    throw failure({ code: 'PROCESS_ACTIVE', message: 'El PID registrado está activo o fue reutilizado. Se conserva ownership.' });
  } });
}
