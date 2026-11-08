import { useEffect, useState } from 'react';
import { Trash2, Pause, Play } from 'lucide-react';
import { subscribe, type RequestLogEntry } from '@/mock/bus';
import { getRequestLog } from '@/mock/server';
import { useUi } from '@/store/ui';
import { cn } from '@/lib/cn';
import { Drawer } from '../ui/Modal';
import { CodeBlock } from '../ui/CodeBlock';
import { Segmented } from '../ui/Tabs';

const METHOD_CLS: Record<string, string> = { GET: 'text-sky-500', POST: 'text-emerald-500', PATCH: 'text-amber-500', PUT: 'text-amber-500', DELETE: 'text-rose-500' };

/** Live view of every API request the UI makes against the (mock) control plane. */
export function ApiInspector() {
  const open = useUi((s) => s.inspectorOpen);
  const setOpen = useUi((s) => s.setInspector);
  const [entries, setEntries] = useState<RequestLogEntry[]>(() => [...getRequestLog()]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<'all' | 'writes' | 'errors'>('all');
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => subscribe((e) => { if (e.kind === 'request' && !paused) setEntries((x) => [e.entry, ...x].slice(0, 300)) }), [paused]);
  const shown = entries.filter((e) => filter === 'all' || (filter === 'writes' ? e.method !== 'GET' : e.status >= 400));
  const selected = entries.find((e) => e.id === sel);
  return (
    <Drawer open={open} onClose={() => setOpen(false)} width="max-w-3xl" title="API inspector" description="Every call the console makes to the Autark REST API (served by the in-browser mock control plane).">
      <div className="mb-3 flex items-center gap-2">
        <Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, { value: 'writes', label: 'Writes' }, { value: 'errors', label: 'Errors' }]} />
        <button onClick={() => setPaused((p) => !p)} className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg">{paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}{paused ? 'Resume' : 'Pause'}</button>
        <button onClick={() => setEntries([])} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg"><Trash2 className="size-3.5" />Clear</button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_1.1fr]">
        <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-line">
          {shown.length === 0 && <div className="p-6 text-center text-sm text-muted">No requests yet — click around the console.</div>}
          {shown.map((e) => (
            <button key={e.id} onClick={() => setSel(e.id)} className={cn('flex w-full items-center gap-2 border-b border-line px-3 py-1.5 text-left font-mono text-[11.5px] last:border-0 hover:bg-surface-2', sel === e.id && 'bg-surface-2')}>
              <span className={cn('w-12 shrink-0 font-semibold', METHOD_CLS[e.method])}>{e.method}</span>
              <span className="min-w-0 flex-1 truncate text-fg-2">{e.path.replace('/api/v1', '')}</span>
              <span className={cn('shrink-0', e.status >= 400 ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400')}>{e.status}</span>
              <span className="w-12 shrink-0 text-right text-faint">{e.durationMs}ms</span>
            </button>
          ))}
        </div>
        <div className="min-w-0">
          {selected ? (
            <div className="space-y-3">
              <div className="font-mono text-xs"><span className={cn('font-semibold', METHOD_CLS[selected.method])}>{selected.method}</span> <span className="text-fg">{selected.path}</span></div>
              {selected.requestBody !== undefined && <CodeBlock title="Request body" language="json" code={JSON.stringify(selected.requestBody, null, 2)} maxHeight="max-h-56" />}
              <CodeBlock title={`Response · ${selected.status}`} language="json" code={JSON.stringify(selected.responseBody, null, 2)?.slice(0, 20000) ?? ''} maxHeight="max-h-[50vh]" />
            </div>
          ) : <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">Select a request</div>}
        </div>
      </div>
    </Drawer>
  );
}
