import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, type TestContext } from 'node:test';
import { acquireHostOwnership, inspectHostOwnership, isHostOwnershipFailure, recoverHostOwnership,parseLinuxZombieEvidence } from '../src/adapters/host-ownership.ts';

function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'personajes-ownership-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, lockPath: join(root, 'host-ownership.json') };
}

test('Linux zombie evidence requires matching PID, state and stable proc start ticks',()=>{
 const stat=(state:string)=>`123 (fixture with spaces) ${state} ${Array.from({length:18},()=> '0').join(' ')} 98765 0`;
 assert.deepEqual(parseLinuxZombieEvidence({pid:123,status:'Pid:\t123\nState:\tZ (zombie)\n',stat:stat('Z')}),{kind:'zombie',startTicks:'98765'});
 assert.deepEqual(parseLinuxZombieEvidence({pid:123,status:'Pid:\t123\nState:\tS (sleeping)\n',stat:stat('S')}),{kind:'alive'});
 assert.equal(parseLinuxZombieEvidence({pid:123,status:'Pid:\t124\nState:\tZ (zombie)\n',stat:stat('Z')}).kind,'ambiguous');
 assert.equal(parseLinuxZombieEvidence({pid:123,status:'Pid:\t123\nState:\tZ (zombie)\n',stat:stat('R')}).kind,'ambiguous');
 assert.equal(parseLinuxZombieEvidence({pid:123,status:'Pid:\t123\nState:\tZ (zombie)\n',stat:'incomplete'}).kind,'ambiguous');
});

test('explicit recovery accepts a real Linux zombie without killing an active process',{skip:process.platform!=='linux'},async t=>{
 const {root,lockPath}=fixture(t);
 const parent=spawn('/usr/bin/python3',['-u','-c',`import os,sys,time
pid=os.fork()
if pid==0: os._exit(0)
time.sleep(0.05)
print(pid,flush=True)
sys.stdin.readline()
os.waitpid(pid,0)
`],{stdio:['pipe','pipe','pipe']});
 const done=new Promise<void>((resolve,reject)=>{parent.once('exit',code=>code===0?resolve():reject(new Error('fixture parent failed')));parent.once('error',reject);});
 try{
  const pid=await new Promise<number>((resolve,reject)=>{parent.stdout.once('data',chunk=>resolve(Number(String(chunk).trim())));parent.once('error',reject);});
  assert.ok(Number.isSafeInteger(pid)&&pid>0);process.kill(pid,0);
  const ownership=acquireHostOwnership({privateDataRoot:root});const record=inspectHostOwnership({privateDataRoot:root});
  writeFileSync(lockPath,JSON.stringify({...record,pid}),{mode:0o600});
  recoverHostOwnership({privateDataRoot:root,expectedNonce:ownership.ownerToken,operatorConfirmed:true});
  assert.equal(existsSync(lockPath),false);const next=acquireHostOwnership({privateDataRoot:root});next.release();
 }finally{parent.stdin.end('\n');await done;}
});

function childAcquire(input: { root: string }) {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/adapters/host-ownership.ts')).href;
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    `import { acquireHostOwnership, isHostOwnershipFailure } from ${JSON.stringify(moduleUrl)};
     try { acquireHostOwnership({ privateDataRoot: ${JSON.stringify(input.root)} }); process.stdout.write('acquired'); }
     catch (error) { if (!isHostOwnershipFailure(error)) throw error; process.stdout.write(error.code); process.exitCode=2; }`,
  ], { encoding: 'utf8', timeout: 10_000 });
}

function childRecoverAtBarrier(input: { root: string; nonce: string; readyPath: string; startPath: string }) {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/adapters/host-ownership.ts')).href;
  const script = `import { existsSync, writeFileSync } from 'node:fs';
    import { recoverHostOwnership, isHostOwnershipFailure } from ${JSON.stringify(moduleUrl)};
    writeFileSync(${JSON.stringify(input.readyPath)}, 'ready');
    const deadline = Date.now() + 10_000;
    while (!existsSync(${JSON.stringify(input.startPath)}) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
    if (!existsSync(${JSON.stringify(input.startPath)})) process.exit(3);
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      try {
        recoverHostOwnership({ privateDataRoot: ${JSON.stringify(input.root)}, expectedNonce: ${JSON.stringify(input.nonce)}, operatorConfirmed: true });
        process.stdout.write('recovered');
        break;
      } catch (error) {
        if (!isHostOwnershipFailure(error)) throw error;
        if (error.code !== 'OPERATION_BUSY') {
          process.stdout.write(error.code);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 2));
      }
    }`;
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd() });
}

function childAcquireAfterBarrier(input: { root: string; readyPath: string; startPath: string; acquiredPath: string; finishPath: string }) {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'src/adapters/host-ownership.ts')).href;
  const script = `import { existsSync, writeFileSync } from 'node:fs';
    import { acquireHostOwnership, inspectHostOwnership, isHostOwnershipFailure } from ${JSON.stringify(moduleUrl)};
    writeFileSync(${JSON.stringify(input.readyPath)}, 'ready');
    const deadline = Date.now() + 10_000;
    while (!existsSync(${JSON.stringify(input.startPath)}) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 2));
    if (!existsSync(${JSON.stringify(input.startPath)})) process.exit(3);
    let owner;
    for (let attempt = 0; attempt < 2_000; attempt += 1) {
      try {
        owner = acquireHostOwnership({ privateDataRoot: ${JSON.stringify(input.root)} });
        break;
      } catch (error) {
        if (!isHostOwnershipFailure(error) || (error.code !== 'ALREADY_OWNED' && error.code !== 'OPERATION_BUSY')) throw error;
        await new Promise(resolve => setTimeout(resolve, 2));
      }
    }
    if (!owner) {
      process.stdout.write('attempts-exhausted');
      process.exitCode = 4;
    } else {
      let inspected = false;
      for (let attempt = 0; attempt < 2_000; attempt += 1) {
        try {
          writeFileSync(${JSON.stringify(input.acquiredPath)}, inspectHostOwnership({ privateDataRoot: ${JSON.stringify(input.root)} }).nonce);
          inspected = true;
          break;
        } catch (error) {
          if (!isHostOwnershipFailure(error) || error.code !== 'OPERATION_BUSY') throw error;
          await new Promise(resolve => setTimeout(resolve, 2));
        }
      }
      const holdDeadline = Date.now() + 10_000;
      while (inspected && !existsSync(${JSON.stringify(input.finishPath)}) && Date.now() < holdDeadline) await new Promise(resolve => setTimeout(resolve, 2));
      owner.release();
      process.stdout.write(inspected ? 'released' : 'inspect-exhausted');
      process.exitCode = inspected && existsSync(${JSON.stringify(input.finishPath)}) ? 0 : 4;
    }`;
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: process.cwd() });
}

function childOutput(child: ReturnType<typeof spawn>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitForFiles(paths: string[]): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!paths.every(existsSync) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(paths.every(existsSync), `No aparecieron los archivos de sincronización: ${paths.join(', ')}`);
}

test('dos procesos reales no adquieren el mismo directorio y sólo el dueño libera', (t) => {
  const { root } = fixture(t);
  const owner = acquireHostOwnership({ privateDataRoot: root });
  const second = childAcquire({ root });
  assert.equal(second.status, 2, second.stderr);
  assert.equal(second.stdout, 'ALREADY_OWNED');
  assert.throws(() => recoverHostOwnership({ privateDataRoot: root, expectedNonce: inspectHostOwnership({ privateDataRoot: root }).nonce, operatorConfirmed: true }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'PROCESS_ACTIVE');
  owner.release();
  owner.release();
  const next = acquireHostOwnership({ privateDataRoot: root });
  next.release();
});

test('tras caída no se roba por edad; recuperación explícita verifica proceso ausente', (t) => {
  const { root } = fixture(t);
  const child = childAcquire({ root });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'acquired');
  assert.throws(() => acquireHostOwnership({ privateDataRoot: root }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'ALREADY_OWNED');
  const record = inspectHostOwnership({ privateDataRoot: root });
  recoverHostOwnership({ privateDataRoot: root, expectedNonce: record.nonce, operatorConfirmed: true });
  const owner = acquireHostOwnership({ privateDataRoot: root });
  owner.release();
});

test('nonce cambiado y PID activo antiguo conservan el lock', (t) => {
  const { root, lockPath } = fixture(t);
  const owner = acquireHostOwnership({ privateDataRoot: root });
  const replacement = { ...inspectHostOwnership({ privateDataRoot: root }), nonce: randomUUID(), processStartedAt: '1970-01-01T00:00:00.000Z' };
  writeFileSync(lockPath, JSON.stringify(replacement));
  assert.throws(() => owner.release(), (error: unknown) => isHostOwnershipFailure(error) && error.code === 'LOCK_CHANGED');
  assert.throws(() => recoverHostOwnership({ privateDataRoot: root, expectedNonce: replacement.nonce, operatorConfirmed: true }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'PROCESS_ACTIVE');
  assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), replacement);
});

test('PID inaccesible se trata como ambiguo, y sólo ESRCH permite recuperación', (t) => {
  const { root, lockPath } = fixture(t);
  const record = { kind: 'host-ownership', schemaVersion: 1, nonce: randomUUID(), pid: 1, processStartedAt: '1970-01-01T00:00:00.000Z' };
  writeFileSync(lockPath, JSON.stringify(record), { mode: 0o600 });
  chmodSync(lockPath, 0o600);
  let expected: 'PROCESS_ACTIVE' | 'PROCESS_AMBIGUOUS' | 'recoverable';
  try {
    process.kill(record.pid, 0);
    expected = 'PROCESS_ACTIVE';
  } catch (error) {
    expected = error instanceof Error && 'code' in error && error.code === 'ESRCH' ? 'recoverable' : 'PROCESS_AMBIGUOUS';
  }

  if (expected === 'recoverable') {
    recoverHostOwnership({ privateDataRoot: root, expectedNonce: record.nonce, operatorConfirmed: true });
    assert.throws(() => inspectHostOwnership({ privateDataRoot: root }),
      (error: unknown) => isHostOwnershipFailure(error) && error.code === 'LOCK_INVALID');
  } else {
    assert.throws(() => recoverHostOwnership({ privateDataRoot: root, expectedNonce: record.nonce, operatorConfirmed: true }),
      (error: unknown) => isHostOwnershipFailure(error) && error.code === expected);
    assert.equal(readFileSync(lockPath, 'utf8'), JSON.stringify(record));
  }
});

test('un registro dañado no se elimina ni habilita otro writer', (t) => {
  const { root, lockPath } = fixture(t);
  writeFileSync(lockPath, '{invalid');
  assert.throws(() => inspectHostOwnership({ privateDataRoot: root }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'LOCK_INVALID');
  assert.throws(() => acquireHostOwnership({ privateDataRoot: root }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'ALREADY_OWNED');
  assert.equal(readFileSync(lockPath, 'utf8'), '{invalid');
});

test('serializa recuperaciones concurrentes antes de habilitar un nuevo writer', async (t) => {
  const { root } = fixture(t);
  const stale = childAcquire({ root });
  assert.equal(stale.status, 0, stale.stderr);
  const nonce = inspectHostOwnership({ privateDataRoot: root }).nonce;
  const startPath = join(root, 'start');
  const finishPath = join(root, 'finish');
  const acquiredPath = join(root, 'acquired');
  const children = [0, 1, 2].map((index) => childRecoverAtBarrier({
    root, nonce, readyPath: join(root, `recover-${index}.ready`), startPath,
  }));
  const childOwner = childAcquireAfterBarrier({
    root, readyPath: join(root, 'acquire.ready'), startPath, acquiredPath, finishPath,
  });
  const recoverResults = children.map(childOutput);
  const ownerResult = childOutput(childOwner);

  await waitForFiles([...children.map((_, index) => join(root, `recover-${index}.ready`)), join(root, 'acquire.ready')]);
  writeFileSync(startPath, 'go');
  try {
    await waitForFiles([acquiredPath]);
  } catch (error) {
    const details = await Promise.all([...recoverResults, ownerResult]);
    assert.fail(`${String(error)}; children=${JSON.stringify(details)}`);
  }
  const acquiredNonce = readFileSync(acquiredPath, 'utf8');
  const completedRecoveries = await Promise.all(recoverResults);
  assert.ok(completedRecoveries.every((result) => result.code === 0 && result.stderr === ''), JSON.stringify(completedRecoveries));
  assert.ok(completedRecoveries.every((result) => ['recovered', 'LOCK_INVALID', 'LOCK_CHANGED'].includes(result.stdout)), JSON.stringify(completedRecoveries));
  assert.ok(completedRecoveries.some((result) => result.stdout === 'recovered'), JSON.stringify(completedRecoveries));
  assert.equal(inspectHostOwnership({ privateDataRoot: root }).nonce, acquiredNonce);
  writeFileSync(finishPath, 'done');
  const completedOwner = await ownerResult;
  assert.equal(completedOwner.code, 0, completedOwner.stderr);
  assert.equal(completedOwner.stdout, 'released');
});

test('gate ocupado falla cerrado y mantiene lock y modo privado', (t) => {
  const { root, lockPath } = fixture(t);
  chmodSync(root, 0o755);
  const owner = acquireHostOwnership({ privateDataRoot: root });
  const gatePath = join(root, 'host-ownership.operation');
  assert.equal(statSync(root).mode & 0o777, 0o700);
  assert.equal(statSync(lockPath).mode & 0o777, 0o600);
  writeFileSync(gatePath, '{operator review}');

  assert.throws(() => acquireHostOwnership({ privateDataRoot: root }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'OPERATION_BUSY');
  assert.throws(() => owner.release(),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'OPERATION_BUSY');
  assert.equal(readFileSync(lockPath, 'utf8').includes(`"pid":${process.pid}`), true);

  rmSync(gatePath);
  owner.release();
});

test('rechaza raíces y registros con enlaces, permisos amplios o tamaño excesivo', (t) => {
  const { root, lockPath } = fixture(t);
  const alias = join(root, 'root-alias');
  symlinkSync(root, alias);
  assert.throws(() => inspectHostOwnership({ privateDataRoot: alias }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'ROOT_INVALID');

  const victim = join(root, 'victim.json');
  writeFileSync(victim, '{"private":"data"}');
  symlinkSync(victim, lockPath);
  assert.throws(() => inspectHostOwnership({ privateDataRoot: root }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'LOCK_INVALID');
  assert.equal(readFileSync(victim, 'utf8'), '{"private":"data"}');
  rmSync(lockPath);

  writeFileSync(lockPath, JSON.stringify({ kind: 'host-ownership', schemaVersion: 1, nonce: randomUUID(), pid: process.pid, processStartedAt: new Date().toISOString() }));
  chmodSync(lockPath, 0o644);
  assert.throws(() => inspectHostOwnership({ privateDataRoot: root }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'LOCK_INVALID');
  rmSync(lockPath);
  writeFileSync(lockPath, 'x'.repeat(2_049));
  assert.throws(() => inspectHostOwnership({ privateDataRoot: root }),
    (error: unknown) => isHostOwnershipFailure(error) && error.code === 'LOCK_INVALID');
  assert.equal(readFileSync(lockPath, 'utf8').length, 2_049);
});
