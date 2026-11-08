import { subscribe, type ServerEvent } from '@/mock/bus';

/**
 * Realtime channel. In production this would be a WebSocket to /api/v1/events; in the demo it's
 * wired to the in-browser mock server's event bus.
 */
export function connectRealtime(onEvent: (e: ServerEvent) => void): () => void {
  return subscribe(onEvent);
}
export type { ServerEvent };
