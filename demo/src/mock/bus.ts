/** In-process event bus that simulates the platform's realtime channel (think WebSocket / SSE). */
export type ServerEvent =
  | { kind: 'change'; collection: string; id: string; op: 'create' | 'update' | 'delete' }
  | { kind: 'request'; entry: RequestLogEntry }
  | { kind: 'reset' };

export interface RequestLogEntry {
  id: number;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  at: number;
  requestBody?: unknown;
  responseBody?: unknown;
}

type Listener = (e: ServerEvent) => void;
const listeners = new Set<Listener>();

export function emit(e: ServerEvent) {
  for (const l of listeners) {
    try { l(e) } catch (err) { console.error('[mock bus] listener failed', err) }
  }
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
