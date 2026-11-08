import { useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, ApiClientError } from './client';
import { connectRealtime } from './realtime';
import { useUi } from '@/store/ui';
import { toast } from '@/components/ui/toast';
import type { MetricSeries, Operation } from '@/types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiClientError && e.status < 500) && n < 2 },
  },
});

const META = new Set(['auditLog', 'notifications', 'operations', 'costs', 'overview', 'allowances']);

/** Invalidate cached queries when the server reports changes (debounced per collection). */
export function useRealtimeInvalidation() {
  useEffect(() => {
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      for (const c of pending) queryClient.invalidateQueries({ queryKey: [c] });
      pending.clear();
    };
    return connectRealtime((e) => {
      if (e.kind === 'reset') { queryClient.invalidateQueries(); return }
      if (e.kind !== 'change') return;
      pending.add(e.collection);
      // derived views: capacity, usage, costs depend on many collections
      if (!META.has(e.collection)) { pending.add('costs'); pending.add('overview'); pending.add('allowances') }
      if (e.collection === 'vms') { pending.add('hosts'); pending.add('providers') }
      if (!timer) timer = setTimeout(flush, 120);
    });
  }, []);
}

function useScopeKey() {
  const accountId = useUi((s) => s.accountId);
  const projectId = useUi((s) => s.projectId);
  return `${accountId}/${projectId}`;
}

type Params = Record<string, string | number | boolean | undefined | null>;

/** List a collection, scoped to the current account/project. */
export function useList<T>(collection: string, params?: Params, opts: { enabled?: boolean; refetchInterval?: number; allProjects?: boolean } = {}) {
  const scope = useScopeKey();
  const q = useQuery({
    queryKey: [collection, 'list', scope, params ?? {}],
    queryFn: () => api.list<T>(collection, params),
    enabled: opts.enabled ?? true,
    refetchInterval: opts.refetchInterval,
    placeholderData: keepPreviousData,
  });
  return { ...q, items: q.data?.items ?? [], total: q.data?.total ?? 0 };
}

/** Fetch one item by id. */
export function useItem<T>(collection: string, id: string | undefined | null, opts: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: [collection, 'item', id],
    queryFn: () => api.get<T>(collection, id!),
    enabled: !!id,
    refetchInterval: opts.refetchInterval,
    retry: false,
  });
}

/** Arbitrary GET on a path. `key` should start with the collection it depends on for invalidation. */
export function useGet<T>(key: unknown[], path: string | null, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  const scope = useScopeKey();
  return useQuery({
    queryKey: [...key, scope, path],
    queryFn: () => api.get_<T>(path!),
    enabled: !!path && (opts.enabled ?? true),
    refetchInterval: opts.refetchInterval,
    placeholderData: keepPreviousData,
  });
}

/** Time-series metrics for a resource; polls to look live. */
export function useMetrics(collection: string, id: string | undefined, metrics: string[], range = '1h') {
  const poll = range === '15m' ? 5_000 : range === '1h' ? 15_000 : 60_000;
  return useQuery({
    queryKey: ['metrics', collection, id, metrics.join(','), range],
    queryFn: () => api.get_<{ series: Record<string, MetricSeries> }>(`/metrics/${collection}/${id}?metrics=${metrics.join(',')}&range=${range}`),
    enabled: !!id,
    refetchInterval: poll,
    placeholderData: keepPreviousData,
  });
}

/**
 * Mutation helper with toast feedback.
 *   const m = useApiMutation((body) => api.action('vms', id, 'start'), { success: 'Starting VM' });
 *   m.mutate(undefined)
 */
export function useApiMutation<TVars = void, TRes = unknown>(
  fn: (vars: TVars) => Promise<TRes>,
  opts: { success?: string | ((res: TRes, vars: TVars) => string); error?: string; onSuccess?: (res: TRes, vars: TVars) => void; onError?: (e: ApiClientError) => void; silent?: boolean } = {},
) {
  const qc = useQueryClient();
  return useMutation<TRes, ApiClientError, TVars>({
    mutationFn: fn,
    onSuccess: (res, vars) => {
      if (opts.success && !opts.silent) toast.success(typeof opts.success === 'function' ? opts.success(res, vars) : opts.success);
      opts.onSuccess?.(res, vars);
      qc.invalidateQueries({ queryKey: ['operations'] });
    },
    onError: (e) => {
      if (!opts.silent) toast.error(opts.error ?? 'Request failed', e.message);
      opts.onError?.(e);
    },
  });
}

/** Operations for a target resource (live). */
export function useOperationsFor(targetId: string | undefined) {
  return useList<Operation>('operations', targetId ? { 'target.id': targetId } : undefined, { enabled: !!targetId });
}

/** Latest running operation for a target, if any. */
export function useActiveOperation(targetId: string | undefined): Operation | undefined {
  const { items } = useOperationsFor(targetId);
  return items.find((o) => o.status === 'running');
}

/** Lookup map helper: id -> item for a list. */
export function useLookup<T extends { id: string }>(collection: string, params?: Params) {
  const { items, isLoading } = useList<T>(collection, params);
  const map = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  return { map, items, isLoading };
}

/** Live clock (re-render every `ms`) for relative timestamps & progress. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms]);
  return now;
}

/** Previous value of something (for animations). */
export function usePrevious<T>(v: T) {
  const r = useRef<T | undefined>(undefined);
  useEffect(() => { r.current = v }, [v]);
  return r.current;
}
