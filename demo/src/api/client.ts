import { currentScope, useUi } from '@/store/ui';

/* ------------------------------------------------------------------------------------------------
 * Thin REST client for the Autark API (served by the in-browser mock server under /api/v1).
 * Every request carries the account / project scope as headers.
 * ---------------------------------------------------------------------------------------------- */

export class ApiClientError extends Error {
  constructor(public status: number, message: string, public code: string, public details?: Record<string, string>) {
    super(message);
  }
}

export const API_BASE = '/api/v1';

export async function request<T = unknown>(method: string, path: string, body?: unknown, opts: { scope?: boolean; retried?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.scope !== false) {
    const s = currentScope();
    headers['x-autark-account'] = s.accountId;
    if (s.projectId) headers['x-autark-project'] = s.projectId;
  }
  const res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    // Deep link into another account the user belongs to: switch scope and retry once.
    if (err.code === 'other_account' && err.details?.accountId && method === 'GET' && opts.scope !== false && !opts.retried) {
      useUi.getState().setScope(err.details.accountId, '');
      import('@/components/ui/toast').then(({ toast }) => toast.info('Switched account', 'This resource belongs to another account.'));
      return request<T>(method, path, body, { ...opts, retried: true });
    }
    throw new ApiClientError(res.status, err.message ?? `Request failed (${res.status})`, err.code ?? 'error', err.details);
  }
  return data as T;
}

function qs(params?: Record<string, string | number | boolean | undefined | null>) {
  if (!params) return '';
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export const api = {
  list: <T>(collection: string, params?: Record<string, string | number | boolean | undefined | null>) =>
    request<{ items: T[]; total: number }>('GET', `/${collection}${qs(params)}`),
  get: <T>(collection: string, id: string) => request<T>('GET', `/${collection}/${encodeURIComponent(id)}`),
  create: <T>(collection: string, body: unknown) => request<T>('POST', `/${collection}`, body),
  update: <T>(collection: string, id: string, patch: unknown) => request<T>('PATCH', `/${collection}/${encodeURIComponent(id)}`, patch),
  remove: (collection: string, id: string, params?: Record<string, string | boolean>) =>
    request<{ ok: boolean; async?: boolean }>('DELETE', `/${collection}/${encodeURIComponent(id)}${qs(params)}`),
  action: <T = unknown>(collection: string, id: string, action: string, body?: unknown) =>
    request<T>('POST', `/${collection}/${encodeURIComponent(id)}/actions/${action}`, body ?? {}),
  get_: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  qs,
};
