import { db } from './db';
import { newId, nowIso, notify, audit } from './framework';
import type { Operation, OperationStep, Ref } from '@/types';

/* ------------------------------------------------------------------------------------------------
 * Long-running operations engine. An operation has ordered steps with durations; a ticker advances
 * them based on wall-clock time (so they also "catch up" after a page reload). When an operation
 * finishes, a registered completion handler mutates the domain state (e.g. VM -> running).
 * ---------------------------------------------------------------------------------------------- */

export interface StepSpec { name: string; ms: number; logs?: string[] }

type CompletionFn = (op: Operation, payload: any) => void;
const handlers = new Map<string, CompletionFn>();

/** Register a named completion handler. Names must be stable (they are persisted with operations). */
export function onOperationComplete(name: string, fn: CompletionFn) { handlers.set(name, fn) }

export interface StartOperationOpts {
  type: string;
  title: string;
  target: Ref & { name?: string };
  steps: StepSpec[];
  actor?: string;
  scope?: { accountId?: string; projectId?: string };
  /** completion handler name + payload */
  onComplete?: string;
  payload?: unknown;
  onFail?: string;
  /** make step N fail (0-based) — for demoing failure paths */
  failAtStep?: number;
  failMessage?: string;
  /** do not raise a notification when finished */
  silent?: boolean;
  /** speed multiplier applied to all step durations (default 1) */
  speed?: number;
}

export function startOperation(o: StartOperationOpts): Operation {
  const speed = o.speed ?? speedFactor();
  const op: Operation = {
    id: newId('op'),
    type: o.type,
    title: o.title,
    target: o.target,
    accountId: o.scope?.accountId,
    projectId: o.scope?.projectId,
    actor: o.actor ?? 'alice@example.com',
    status: 'running',
    progress: 0,
    steps: o.steps.map<OperationStep>((s) => ({ name: s.name, durationMs: Math.max(150, Math.round(s.ms * speed)), status: 'pending', logs: [] })),
    createdAt: nowIso(),
    startedAt: nowIso(),
    completion: o.onComplete || o.onFail ? { handler: o.onComplete ?? '', payload: o.payload, failHandler: o.onFail } : undefined,
  };
  (op as any)._logPlan = o.steps.map((s) => s.logs ?? []);
  (op as any)._silent = !!o.silent;
  if (o.failAtStep != null) (op as any)._failAt = { step: o.failAtStep, message: o.failMessage ?? 'Step failed' };
  db.insert('operations', op as any);
  ensureTicker();
  return op;
}

function speedFactor(): number {
  try {
    const s = JSON.parse(localStorage.getItem('autark.mock.settings') || '{}');
    return typeof s.opSpeed === 'number' ? s.opSpeed : 1;
  } catch { return 1 }
}

let timer: ReturnType<typeof setInterval> | null = null;
export function ensureTicker() {
  if (timer) return;
  timer = setInterval(tick, 350);
}

function tick() {
  const running = db.filter<Operation>('operations', (o) => o.status === 'running');
  if (!running.length) return;
  const now = Date.now();
  for (const op of running) advance(op, now);
}

function advance(op: Operation, now: number) {
  const started = Date.parse(op.startedAt ?? op.createdAt);
  let elapsed = now - started;
  const plan: string[][] = (op as any)._logPlan ?? [];
  const failAt = (op as any)._failAt as { step: number; message: string } | undefined;
  let changed = false;
  let cursor = started;
  let finished = true;
  let failed: string | null = null;
  const total = op.steps.reduce((a, s) => a + s.durationMs, 0);
  let doneMs = 0;

  const steps = op.steps.map((s, i) => ({ ...s, logs: [...s.logs] }));
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const logs = plan[i] ?? [];
    if (elapsed >= s.durationMs) {
      if (failAt && failAt.step === i) {
        if (s.status !== 'failed') { s.status = 'failed'; s.finishedAt = new Date(cursor + s.durationMs).toISOString(); s.logs = [...logs, `ERROR: ${failAt.message}`]; changed = true }
        failed = failAt.message;
        for (let j = i + 1; j < steps.length; j++) if (steps[j].status !== 'skipped') { steps[j].status = 'skipped'; changed = true }
        break;
      }
      if (s.status !== 'done') {
        s.status = 'done';
        s.startedAt ??= new Date(cursor).toISOString();
        s.finishedAt = new Date(cursor + s.durationMs).toISOString();
        s.logs = logs.slice();
        changed = true;
      }
      elapsed -= s.durationMs;
      cursor += s.durationMs;
      doneMs += s.durationMs;
    } else {
      finished = false;
      if (s.status !== 'running') { s.status = 'running'; s.startedAt = new Date(cursor).toISOString(); changed = true }
      const reveal = Math.min(logs.length, Math.floor((elapsed / s.durationMs) * logs.length) + 1);
      if (reveal !== s.logs.length) { s.logs = logs.slice(0, reveal); changed = true }
      doneMs += elapsed;
      break;
    }
  }

  const progress = failed ? op.progress : Math.min(1, doneMs / Math.max(1, total));
  if (failed) {
    db.update<any>('operations', op.id, { steps, status: 'failed', error: failed, finishedAt: nowIso() });
    runHandler(op, op.completion?.failHandler);
    if (!(op as any)._silent) notify('error', `${op.title} failed`, failed, linkFor(op), op.accountId);
    audit('system', op.type, op.target, { result: 'failure', details: failed, accountId: op.accountId, projectId: op.projectId });
    return;
  }
  if (finished) {
    db.update<any>('operations', op.id, { steps, status: 'succeeded', progress: 1, finishedAt: nowIso() });
    runHandler(op, op.completion?.handler);
    if (!(op as any)._silent) notify('success', op.title, 'Completed successfully', linkFor(op), op.accountId);
    return;
  }
  if (changed) db.update<any>('operations', op.id, { steps, progress });
}

function runHandler(op: Operation, name?: string) {
  if (!name) return;
  const fn = handlers.get(name);
  if (!fn) { console.warn('[ops] no completion handler', name); return }
  try { fn(op, op.completion?.payload) } catch (e) { console.error('[ops] completion handler failed', name, e) }
}

/** filled in by handlers/index via setOperationLinker to avoid import cycles */
let linker: (op: Operation) => string | undefined = () => undefined;
export function setOperationLinker(fn: (op: Operation) => string | undefined) { linker = fn }
function linkFor(op: Operation) { return linker(op) }

/** Convenience: transitional state change, e.g. stopping -> stopped */
export function transition(opts: {
  collection: string; id: string; kind: Ref['type']; name: string; type: string; title: string;
  during: Record<string, unknown>; steps: StepSpec[]; onComplete: string; payload?: unknown; scope?: { accountId?: string; projectId?: string };
  actor?: string; silent?: boolean;
}): Operation {
  db.update(opts.collection, opts.id, opts.during as any);
  return startOperation({
    type: opts.type, title: opts.title, target: { type: opts.kind, id: opts.id, name: opts.name }, steps: opts.steps,
    onComplete: opts.onComplete, payload: opts.payload, scope: opts.scope, actor: opts.actor, silent: opts.silent ?? true,
  });
}

/** Generic completion: patch a row (payload: {collection, id, patch}) */
onOperationComplete('generic.patch', (_op, p: { collection: string; id: string; patch: Record<string, unknown> }) => {
  if (db.get(p.collection, p.id)) db.update(p.collection, p.id, p.patch as any);
});
/** Generic completion: delete a row (payload: {collection, id}) */
onOperationComplete('generic.delete', (_op, p: { collection: string; id: string }) => {
  db.remove(p.collection, p.id);
});
