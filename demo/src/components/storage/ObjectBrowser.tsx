import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'react-router';
import {
  Upload, FolderPlus, RefreshCw, Search, ChevronRight, Home, MoreHorizontal, Eye, Download, Copy, Link2, Pencil, FolderInput, Trash2, X, CheckCircle2, XCircle,
  Loader2, Lock, UploadCloud, Globe, FolderUp, ArrowUp, ArrowDown, Files,
} from 'lucide-react';
import { useGet, useItem } from '@/api/hooks';
import { api } from '@/api/client';
import { useQueryClient } from '@tanstack/react-query';
import { Button, IconButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { Modal, Drawer, confirm } from '@/components/ui/Modal';
import { Field, Input, Select, Checkbox, Hint } from '@/components/ui/form';
import { Segmented } from '@/components/ui/Tabs';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { KeyValue } from '@/components/ui/Card';
import { Mono, Skeleton, EmptyState } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { useList } from '@/api/hooks';
import { bytes, timeAgo, dateTime, num } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ClassBadge, objectIcon, isTextual, downloadFile } from './common';
import type { Bucket, BucketObject, ObjectListing } from '@/types';

const INLINE_LIMIT = 150 * 1024;

interface UploadItem { id: string; name: string; key: string; size: number; progress: number; status: 'queued' | 'reading' | 'uploading' | 'done' | 'error'; error?: string }
type Row = { kind: 'folder'; key: string; name: string; size: number; count: number; modified: string | null } | { kind: 'object'; key: string; name: string; size: number; modified: string; obj: ObjectListing['objects'][number] };

const parentOf = (key: string) => { const i = key.lastIndexOf('/', key.length - 2); return i >= 0 ? key.slice(0, i + 1) : '' };
const baseName = (key: string) => key.slice(parentOf(key).length).replace(/\/$/, '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function guessCt(name: string, fallback: string) {
  if (fallback) return fallback;
  const ext = name.split('.').pop()?.toLowerCase();
  return ({ md: 'text/markdown', json: 'application/json', yaml: 'application/yaml', yml: 'application/yaml', ts: 'text/plain', tsx: 'text/plain', log: 'text/plain', tf: 'text/plain', toml: 'text/plain', env: 'text/plain' } as Record<string, string>)[ext ?? ''] ?? 'application/octet-stream';
}

/** Read a small text/image file inline (reports real read progress). */
function readInline(file: File, ct: string, onProgress: (p: number) => void): Promise<string | undefined> {
  const text = isTextual(ct) && !ct.includes('svg') ? true : ct.startsWith('image/') ? false : null;
  if (text === null || file.size > INLINE_LIMIT) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) };
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : undefined);
    r.onerror = () => resolve(undefined);
    if (text) r.readAsText(file); else r.readAsDataURL(file);
  });
}

/** Recursively collect files from a drop (supports dropped folders). */
async function filesFromDrop(e: DragEvent): Promise<{ file: File; path: string }[]> {
  const items = [...e.dataTransfer.items];
  const entries = items.map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...e.dataTransfer.files].map((f) => ({ file: f, path: f.name }));
  const out: { file: File; path: string }[] = [];
  const walk = async (entry: any, path: string): Promise<void> => {
    if (entry.isFile) { const f: File = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file: f, path: path + f.name }) }
    else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch: any[] = [];
      do { batch = await new Promise((res) => reader.readEntries(res, () => res([]))); for (const c of batch) await walk(c, `${path}${entry.name}/`) } while (batch.length);
    }
  };
  for (const en of entries) await walk(en, '');
  return out;
}

export function ObjectBrowser({ bucket }: { bucket: Bucket }) {
  const [sp, setSp] = useSearchParams();
  const qc = useQueryClient();
  const prefix = sp.get('prefix') ?? '';
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 250); return () => clearTimeout(t) }, [q]);
  const { data, isLoading, isFetching, refetch } = useGet<ObjectListing>(['bucketObjects', bucket.id], `/buckets/${bucket.id}/objects${api.qs({ prefix, q: debouncedQ })}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ by: 'name' | 'size' | 'modified'; dir: 1 | -1 }>({ by: 'name', dir: 1 });
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [drag, setDrag] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [relocate, setRelocate] = useState<{ keys: string[]; mode: 'copy' | 'move' } | null>(null);
  const [presign, setPresign] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const writable = (bucket.status ?? 'active') === 'active';

  const go = useCallback((p: string) => {
    const n = new URLSearchParams(sp);
    if (p) n.set('prefix', p); else n.delete('prefix');
    n.delete('object');
    setSp(n, { replace: false });
    setSelected(new Set()); setQ('');
  }, [sp, setSp]);

  // deep link (?object=key) from global search
  useEffect(() => {
    const k = sp.get('object');
    if (k && data?.objects.some((o) => o.key === k)) { setPreview(k); const n = new URLSearchParams(sp); n.delete('object'); setSp(n, { replace: true }) }
  }, [data, sp]); // eslint-disable-line

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const folders: Row[] = data.folders.map((f) => ({ kind: 'folder', key: f.prefix, name: f.name, size: f.sizeBytes, count: f.objectCount, modified: f.lastModified }));
    const objs: Row[] = data.objects.map((o) => ({ kind: 'object', key: o.key, name: debouncedQ ? o.key.slice(prefix.length) : baseName(o.key), size: o.sizeBytes, modified: o.lastModified, obj: o }));
    const cmp = (a: Row, b: Row) => sort.by === 'size' ? a.size - b.size : sort.by === 'modified' ? String(a.modified ?? '').localeCompare(String(b.modified ?? '')) : a.name.localeCompare(b.name, undefined, { numeric: true });
    return [...folders.sort((a, b) => cmp(a, b) * sort.dir), ...objs.sort((a, b) => cmp(a, b) * sort.dir)];
  }, [data, sort, debouncedQ, prefix]);

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n });
  const refresh = () => qc.invalidateQueries({ queryKey: ['bucketObjects'] });

  /* ------------------------------------------------------------ uploads */
  const startUploads = async (files: { file: File; path: string }[]) => {
    if (!writable) { toast.error('Bucket is not writable right now', `Status: ${bucket.status}`); return }
    if (!files.length) return;
    const items: UploadItem[] = files.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.path, key: prefix + f.path, size: f.file.size, progress: 0, status: 'queued' }));
    setUploads((u) => [...u.filter((x) => x.status !== 'done'), ...items]);
    const patch = (id: string, p: Partial<UploadItem>) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, ...p } : x)));
    let ok = 0;
    const queue = files.map((f, i) => ({ ...f, item: items[i] }));
    const worker = async () => {
      while (queue.length) {
        const { file, item } = queue.shift()!;
        const ct = guessCt(file.name, file.type);
        try {
          patch(item.id, { status: 'reading' });
          const content = await readInline(file, ct, (p) => patch(item.id, { progress: p * 0.25 }));
          patch(item.id, { status: 'uploading', progress: 0.25 });
          // simulated network transfer: ~60 MB/s, 0.4–5 s
          const total = Math.min(5000, Math.max(400, (file.size / (60 * 1024 * 1024)) * 1000));
          const t0 = performance.now();
          while (performance.now() - t0 < total) {
            await sleep(80);
            patch(item.id, { progress: 0.25 + 0.7 * Math.min(1, (performance.now() - t0) / total) });
          }
          await api.post(`/buckets/${bucket.id}/objects`, { key: item.key, sizeBytes: file.size, contentType: ct, content });
          patch(item.id, { status: 'done', progress: 1 });
          ok++;
        } catch (e) {
          patch(item.id, { status: 'error', error: (e as Error).message });
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    refresh();
    if (ok) toast.success(`Uploaded ${ok} object${ok > 1 ? 's' : ''}`, ok < files.length ? `${files.length - ok} failed` : `to s3://${bucket.name}/${prefix}`);
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault(); setDrag(0);
    startUploads(await filesFromDrop(e));
  };

  /* ------------------------------------------------------------ actions */
  const s3uri = (k: string) => `s3://${bucket.name}/${k}`;
  const copy = (text: string, label = 'Copied') => { navigator.clipboard?.writeText(text).catch(() => {}); toast.success(label, text.length > 80 ? text.slice(0, 80) + '…' : text) };

  const removeKeys = async (keys: string[]) => {
    const folderRows = rows.filter((r) => keys.includes(r.key) && r.kind === 'folder');
    const objCount = keys.length - folderRows.length + folderRows.reduce((a, r) => a + (r.kind === 'folder' ? r.count : 0), 0);
    const ok = await confirm({
      title: `Delete ${keys.length === 1 ? baseName(keys[0]) : `${keys.length} items`}?`,
      message: <>
        {objCount.toLocaleString()} object{objCount === 1 ? '' : 's'} will be permanently deleted{folderRows.length ? ` (including everything inside ${folderRows.length} folder${folderRows.length > 1 ? 's' : ''})` : ''}.
        {bucket.versioning && ' Versioning is on: all stored versions of these objects are removed too.'}
      </>,
      confirmLabel: 'Delete', danger: true, typeToConfirm: objCount > 20 ? 'delete' : undefined,
    });
    if (!ok) return;
    try {
      const res = await api.action<{ deleted: number }>('buckets', bucket.id, 'deleteObjects', { keys });
      toast.success(`Deleted ${res.deleted} object${res.deleted === 1 ? '' : 's'}`);
      setSelected(new Set()); if (preview && keys.includes(preview)) setPreview(null);
      refresh();
    } catch (e) { toast.error('Delete failed', (e as Error).message) }
  };

  const download = async (o: ObjectListing['objects'][number]) => {
    if (o.hasContent) {
      try { const full = await api.get<BucketObject>('bucketObjects', o.id); downloadFile(baseName(o.key), full.content ?? '', o.contentType); return } catch (e) { toast.error('Download failed', (e as Error).message); return }
    }
    try {
      const res = await api.action<{ url: string }>('buckets', bucket.id, 'presign', { key: o.key, expiresIn: 900 });
      copy(res.url, 'Presigned download URL copied (valid 15 min)');
    } catch (e) { toast.error('Download failed', (e as Error).message) }
  };

  const menuFor = (r: Row) => (
    <Menu trigger={() => <IconButton icon={MoreHorizontal} label="Actions" size="xs" />} items={[
      ...(r.kind === 'object' ? [
        { label: 'Preview & details', icon: Eye, onClick: () => setPreview(r.key) },
        { label: 'Download', icon: Download, onClick: () => download(r.obj) },
      ] : [{ label: 'Open folder', icon: Eye, onClick: () => go(r.key) }]),
      { label: 'Copy S3 URI', icon: Copy, onClick: () => copy(s3uri(r.key), 'S3 URI copied') },
      ...(r.kind === 'object' && bucket.access === 'public-read' ? [{ label: 'Copy public URL', icon: Globe, onClick: () => copy(`${bucket.endpoint}/${r.key}`, 'Public URL copied') }] : []),
      ...(r.kind === 'object' ? [{ label: 'Presigned URL…', icon: Link2, onClick: () => setPresign(r.key) }] : []),
      { divider: true, label: '' },
      { label: 'Rename', icon: Pencil, disabled: !writable, onClick: () => setRename(r.key) },
      { label: 'Copy to…', icon: Files, disabled: !writable, onClick: () => setRelocate({ keys: [r.key], mode: 'copy' }) },
      { label: 'Move to…', icon: FolderInput, disabled: !writable, onClick: () => setRelocate({ keys: [r.key], mode: 'move' }) },
      { divider: true, label: '' },
      { label: 'Delete', icon: Trash2, danger: true, disabled: !writable, onClick: () => removeKeys([r.key]) },
    ]} />
  );

  const crumbs = prefix.split('/').filter(Boolean);
  const sortHead = (by: typeof sort.by, label: string, cls?: string) => (
    <button type="button" onClick={() => setSort((s) => ({ by, dir: s.by === by ? (s.dir === 1 ? -1 : 1) : 1 }))} className={cn('inline-flex items-center gap-1 hover:text-fg', cls)}>
      {label}{sort.by === by && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  );
  const activeUploads = uploads.filter((u) => u.status !== 'done' && u.status !== 'error').length;

  return (
    <div
      className="relative"
      onDragEnter={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag((d) => d + 1) } }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDragLeave={() => setDrag((d) => Math.max(0, d - 1))}
      onDrop={onDrop}
    >
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { const fs = [...(e.target.files ?? [])].map((f) => ({ file: f, path: f.name })); e.target.value = ''; startUploads(fs) }} />
      <input ref={dirRef} type="file" multiple className="hidden" {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => { const fs = [...(e.target.files ?? [])].map((f) => ({ file: f, path: (f as any).webkitRelativePath || f.name })); e.target.value = ''; startUploads(fs) }} />

      {/* toolbar */}
      <div className="mb-3 flex flex-col gap-2 @min-[44rem]:flex-row @min-[44rem]:items-center @min-[44rem]:justify-between">
        <nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm" aria-label="Folder path">
          <button onClick={() => go('')} className={cn('flex items-center gap-1.5 rounded-md px-1.5 py-1 font-medium hover:bg-surface-2', prefix ? 'text-muted' : 'text-fg')}><Home className="size-3.5" />{bucket.name}</button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight className="size-3.5 shrink-0 text-faint" />
              <button onClick={() => go(crumbs.slice(0, i + 1).join('/') + '/')} className={cn('truncate rounded-md px-1.5 py-1 hover:bg-surface-2', i === crumbs.length - 1 ? 'font-medium text-fg' : 'text-muted')}>{c}</button>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full @min-[36rem]:w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={prefix ? `Search in ${crumbs.at(-1)}/…` : 'Search keys…'} className="h-8 pl-8" />
          </div>
          <IconButton icon={RefreshCw} label="Refresh" size="sm" variant="secondary" onClick={() => refetch()} className={cn(isFetching && '[&>svg]:animate-spin')} />
          <Button size="sm" icon={FolderPlus} disabled={!writable} onClick={() => setNewFolder(true)}>New folder</Button>
          <Menu trigger={() => <Button size="sm" variant="primary" icon={Upload} disabled={!writable}>Upload</Button>} items={[
            { label: 'Upload files…', icon: Upload, onClick: () => fileRef.current?.click() },
            { label: 'Upload folder…', icon: FolderUp, onClick: () => dirRef.current?.click() },
          ]} />
        </div>
      </div>

      {/* uploads */}
      {uploads.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-[13px]">
            <span className="flex items-center gap-2 font-medium text-fg">
              {activeUploads ? <Loader2 className="size-4 animate-spin text-brand-500" /> : <CheckCircle2 className="size-4 text-emerald-500" />}
              {activeUploads ? `Uploading ${activeUploads} of ${uploads.length}…` : `${uploads.filter((u) => u.status === 'done').length} uploaded${uploads.some((u) => u.status === 'error') ? `, ${uploads.filter((u) => u.status === 'error').length} failed` : ''}`}
            </span>
            {!activeUploads && <Button size="xs" variant="ghost" icon={X} onClick={() => setUploads([])}>Clear</Button>}
          </div>
          <ul className="max-h-48 divide-y divide-line overflow-y-auto">
            {uploads.map((u) => (
              <li key={u.id} className="px-3 py-2">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-mono text-fg-2">{u.name}</span>
                  <span className={cn('shrink-0 tabular', u.status === 'error' ? 'text-rose-500' : 'text-muted')}>
                    {u.status === 'error' ? <span className="flex items-center gap-1"><XCircle className="size-3.5" />failed</span> : u.status === 'done' ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : `${bytes(u.size * u.progress)} / ${bytes(u.size)}`}
                  </span>
                </div>
                {u.status === 'error' ? <p className="mt-0.5 text-[11px] text-rose-500">{u.error}</p> : (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3"><div className={cn('h-full rounded-full transition-all duration-150', u.status === 'done' ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${u.progress * 100}%` }} /></div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* selection bar */}
      {selected.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/5 px-3 py-2">
          <span className="text-[13px] font-medium text-fg">{selected.size} selected</span>
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="xs" icon={Copy} onClick={() => copy([...selected].map(s3uri).join('\n'), 'S3 URIs copied')}>Copy URIs</Button>
            <Button size="xs" icon={Files} disabled={!writable} onClick={() => setRelocate({ keys: [...selected], mode: 'copy' })}>Copy to…</Button>
            <Button size="xs" icon={FolderInput} disabled={!writable} onClick={() => setRelocate({ keys: [...selected], mode: 'move' })}>Move to…</Button>
            <Button size="xs" variant="outline-danger" icon={Trash2} disabled={!writable} onClick={() => removeKeys([...selected])}>Delete</Button>
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        </div>
      )}

      {/* listing */}
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        {isLoading && !data ? <div className="space-y-2 p-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div>
        : rows.length === 0 ? (
          debouncedQ ? <EmptyState icon={Search} title="No matching objects" description={`Nothing under ${prefix || '/'} matches "${debouncedQ}".`} /> : (
            <button type="button" disabled={!writable} onClick={() => fileRef.current?.click()} className="m-3 flex w-[calc(100%-1.5rem)] flex-col items-center justify-center rounded-xl border-2 border-dashed border-line-strong px-6 py-14 text-center transition-colors hover:border-brand-500 hover:bg-brand-500/5">
              <UploadCloud className="mb-3 size-10 text-brand-500" />
              <span className="text-[15px] font-semibold text-fg">{prefix ? 'This folder is empty' : 'This bucket is empty'}</span>
              <span className="mt-1 text-sm text-muted">Drag & drop files or folders here, or click to browse.</span>
            </button>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2/60 text-left text-xs font-medium text-muted">
                <tr>
                  <th className="w-9 py-2 pl-3"><Checkbox checked={allSelected} indeterminate={!allSelected && selected.size > 0} onChange={(v) => setSelected(v ? new Set(rows.map((r) => r.key)) : new Set())} /></th>
                  <th className="py-2 pr-3">{sortHead('name', 'Name')}</th>
                  <th className="py-2 pr-3 text-right">{sortHead('size', 'Size')}</th>
                  <th className="hidden py-2 pr-3 @min-[40rem]:table-cell">Class</th>
                  <th className="hidden py-2 pr-3 @min-[36rem]:table-cell">{sortHead('modified', 'Last modified')}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {prefix && !debouncedQ && (
                  <tr className="cursor-pointer hover:bg-surface-2/50" onClick={() => go(parentOf(prefix))}>
                    <td /><td colSpan={5} className="py-2 pr-3 text-muted">.. <span className="text-xs">(up one level)</span></td>
                  </tr>
                )}
                {rows.map((r) => {
                  const { icon: Icon, color } = objectIcon(r.kind === 'object' ? r.obj.contentType : '', r.kind === 'folder');
                  const locked = r.kind === 'object' && r.obj.retainUntil && Date.parse(r.obj.retainUntil) > Date.now();
                  return (
                    <tr key={r.key} className={cn('group hover:bg-surface-2/50', selected.has(r.key) && 'bg-brand-500/[0.04]')}>
                      <td className="py-2 pl-3"><Checkbox checked={selected.has(r.key)} onChange={() => toggle(r.key)} /></td>
                      <td className="max-w-0 py-2 pr-3">
                        <button type="button" onClick={() => (r.kind === 'folder' ? go(r.key) : setPreview(r.key))} className="flex w-full min-w-0 items-center gap-2.5 text-left">
                          <Icon className="size-4 shrink-0" style={{ color }} />
                          <span className="truncate font-medium text-fg group-hover:text-brand-500">{r.name}{r.kind === 'folder' && '/'}</span>
                          {locked && <span title={`Object lock: retained until ${dateTime(r.obj.retainUntil)}`}><Lock className="size-3 shrink-0 text-amber-500" /></span>}
                          {r.kind === 'object' && (r.obj.versions ?? 1) > 1 && <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] text-muted" title="Stored versions">v{r.obj.versions}</span>}
                        </button>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular text-fg-2">{r.kind === 'folder' ? <span className="text-xs text-muted">{num(r.count)} obj · {bytes(r.size)}</span> : bytes(r.size)}</td>
                      <td className="hidden py-2 pr-3 @min-[40rem]:table-cell">{r.kind === 'object' ? <ClassBadge value={r.obj.storageClass} /> : <span className="text-faint">—</span>}</td>
                      <td className="hidden whitespace-nowrap py-2 pr-3 text-fg-2 @min-[36rem]:table-cell" title={dateTime(r.modified)}>{r.modified ? timeAgo(r.modified) : '—'}</td>
                      <td className="py-2 pr-2 text-right">{menuFor(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
            <span>{data.folders.length} folder{data.folders.length === 1 ? '' : 's'} · {data.objects.length} object{data.objects.length === 1 ? '' : 's'}{debouncedQ ? ' matched' : ''}</span>
            <span className="hidden @min-[36rem]:inline">Drop files anywhere to upload to <span className="font-mono">/{prefix}</span></span>
          </div>
        )}
      </div>

      {drag > 0 && writable && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-500 bg-brand-500/10 backdrop-blur-[1px]">
          <div className="flex flex-col items-center rounded-xl bg-surface px-6 py-4 text-center shadow-pop">
            <UploadCloud className="mb-2 size-8 text-brand-500" />
            <span className="font-semibold text-fg">Drop to upload</span>
            <span className="font-mono text-xs text-muted">s3://{bucket.name}/{prefix}</span>
          </div>
        </div>
      )}

      {preview && <PreviewDrawer bucket={bucket} objectKey={preview} listing={data} onClose={() => setPreview(null)} onDelete={() => removeKeys([preview])} onPresign={() => setPresign(preview)} onDownload={download} />}
      {newFolder && <NewFolderModal bucket={bucket} prefix={prefix} onClose={() => setNewFolder(false)} onDone={refresh} />}
      {rename && <RenameModal bucket={bucket} objectKey={rename} onClose={() => setRename(null)} onDone={() => { setSelected(new Set()); refresh() }} />}
      {relocate && <RelocateModal bucket={bucket} prefix={prefix} keys={relocate.keys} mode={relocate.mode} onClose={() => setRelocate(null)} onDone={() => { setSelected(new Set()); refresh() }} />}
      {presign && <PresignModal bucket={bucket} objectKey={presign} onClose={() => setPresign(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ preview drawer */

function PreviewDrawer({ bucket, objectKey, listing, onClose, onDelete, onPresign, onDownload }: {
  bucket: Bucket; objectKey: string; listing?: ObjectListing; onClose: () => void; onDelete: () => void; onPresign: () => void; onDownload: (o: ObjectListing['objects'][number]) => void;
}) {
  const meta = listing?.objects.find((o) => o.key === objectKey);
  const { data: full, isLoading } = useItem<BucketObject>('bucketObjects', meta?.id);
  const [wrap, setWrap] = useState(true);
  if (!meta) return null;
  const ct = meta.contentType;
  const content = full?.content;
  let body: React.ReactNode;
  if (isLoading) body = <Skeleton className="h-48" />;
  else if (content && (ct.startsWith('image/') || ct.includes('svg'))) {
    const src = content.startsWith('data:') ? content : `data:image/svg+xml;utf8,${encodeURIComponent(content)}`;
    body = <div className="flex items-center justify-center rounded-xl border border-line bg-[repeating-conic-gradient(var(--surface-3)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-4"><img src={src} alt={objectKey} className="max-h-80 max-w-full object-contain" /></div>;
  } else if (content && isTextual(ct)) {
    let code = content; let lang = ct.includes('json') ? 'json' : ct.includes('yaml') ? 'yaml' : undefined;
    if (lang === 'json') { try { code = JSON.stringify(JSON.parse(content), null, 2) } catch { lang = undefined } }
    body = <>
      <div className="mb-1.5 flex justify-end"><Segmented size="sm" value={wrap ? 'wrap' : 'nowrap'} onChange={(v) => setWrap(v === 'wrap')} options={[{ value: 'wrap', label: 'Wrap' }, { value: 'nowrap', label: 'No wrap' }]} /></div>
      <CodeBlock code={code} language={lang} title={`${bytes(meta.sizeBytes)} · ${ct}`} wrap={wrap} maxHeight="max-h-[50vh]" />
    </>;
  } else {
    const { icon: Icon, color } = objectIcon(ct);
    body = (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-4 py-10 text-center">
        <Icon className="mb-2 size-10" style={{ color }} />
        <p className="text-sm font-medium text-fg">No inline preview</p>
        <p className="mt-1 text-xs text-muted">{ct} · {bytes(meta.sizeBytes)}. Download it or share a presigned URL.</p>
      </div>
    );
  }
  const locked = meta.retainUntil && Date.parse(meta.retainUntil) > Date.now();
  return (
    <Drawer open onClose={onClose} title={baseName(objectKey)} description={<span className="font-mono text-xs">s3://{bucket.name}/{objectKey}</span>} width="max-w-2xl"
      footer={<>
        <Button variant="outline-danger" icon={Trash2} disabled={!!locked} onClick={onDelete} className="mr-auto">Delete</Button>
        <Button icon={Link2} onClick={onPresign}>Presigned URL</Button>
        <Button variant="primary" icon={Download} onClick={() => onDownload(meta)}>Download</Button>
      </>}>
      <div className="space-y-5">
        {body}
        {locked && <Hint tone="warning">Object lock ({bucket.objectLockMode ?? 'governance'}): this object cannot be deleted or overwritten until {dateTime(meta.retainUntil)}.</Hint>}
        <KeyValue items={[
          ['Key', <Mono copy={objectKey}>{objectKey}</Mono>],
          ['Size', `${bytes(meta.sizeBytes)} (${meta.sizeBytes.toLocaleString()} B)`],
          ['Content type', ct],
          ['Storage class', <ClassBadge value={meta.storageClass} />],
          ['Last modified', dateTime(meta.lastModified)],
          ['ETag', <Mono copy={meta.etag}>{meta.etag}</Mono>],
          ['Versions', bucket.versioning ? `${meta.versions ?? 1} stored` : 'versioning off'],
          ['Encryption', bucket.encryption === 'none' ? 'none' : `${bucket.encryption} (AES-256-GCM)`],
          ['S3 URI', <Mono copy>{`s3://${bucket.name}/${objectKey}`}</Mono>],
          ['Object URL', <Mono copy>{`${bucket.endpoint}/${objectKey}`}</Mono>],
        ]} />
        {bucket.access === 'public-read' && <Hint tone="warning">This bucket is public — anyone can fetch <span className="font-mono">{bucket.endpoint}/{objectKey}</span>.</Hint>}
        <CodeBlock language="bash" title="Fetch with the CLI" code={`aws s3 cp s3://${bucket.name}/${objectKey} . \\\n  --endpoint-url https://s3.${bucket.locationId}.autark.cloud`} />
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ modals */

function NewFolderModal({ bucket, prefix, onClose, onDone }: { bucket: Bucket; prefix: string; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { await api.post(`/buckets/${bucket.id}/folders`, { prefix, name }); toast.success(`Created folder ${name}/`); onDone(); onClose() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  };
  return (
    <Modal open onClose={onClose} size="sm" title="New folder" description={<>In <span className="font-mono">s3://{bucket.name}/{prefix}</span></>}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={submit}>Create</Button></>}>
      <Field label="Folder name" error={err} hint="S3 has no real folders — this creates a zero-byte marker object ending in “/”.">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="reports" onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()} />
      </Field>
    </Modal>
  );
}

function RenameModal({ bucket, objectKey, onClose, onDone }: { bucket: Bucket; objectKey: string; onClose: () => void; onDone: () => void }) {
  const isFolder = objectKey.endsWith('/');
  const parent = parentOf(objectKey);
  const [name, setName] = useState(baseName(objectKey));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.action<{ count: number }>('buckets', bucket.id, 'renameObject', { key: objectKey, newKey: parent + name.replace(/\/+$/, '') + (isFolder ? '/' : '') });
      toast.success(`Renamed to ${name}`, res.count > 1 ? `${res.count} objects updated` : undefined); onDone(); onClose();
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Rename ${isFolder ? 'folder' : 'object'}`} description={isFolder ? 'Every object under this prefix is re-keyed (server-side copy + delete).' : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim() || name === baseName(objectKey)} onClick={submit}>Rename</Button></>}>
      <Field label="New name" error={err}><Input value={name} onChange={(e) => setName(e.target.value)} prefix={parent ? `…/${parent.split('/').filter(Boolean).at(-1)}/` : '/'} mono onKeyDown={(e) => e.key === 'Enter' && submit()} /></Field>
    </Modal>
  );
}

function RelocateModal({ bucket, prefix, keys, mode: initialMode, onClose, onDone }: { bucket: Bucket; prefix: string; keys: string[]; mode: 'copy' | 'move'; onClose: () => void; onDone: () => void }) {
  const { items: buckets } = useList<Bucket>('buckets');
  const [mode, setMode] = useState(initialMode);
  const [destBucketId, setDestBucketId] = useState(bucket.id);
  const [destPrefix, setDestPrefix] = useState(prefix);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const targets = buckets.filter((b) => b.accountId === bucket.accountId && (b.status ?? 'active') === 'active');
  const dp = destPrefix && !destPrefix.endsWith('/') ? destPrefix + '/' : destPrefix;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await api.action<{ count: number }>('buckets', bucket.id, mode === 'move' ? 'moveObjects' : 'copyObjects', { keys, sourcePrefix: prefix, destBucketId, destPrefix: dp });
      toast.success(`${mode === 'move' ? 'Moved' : 'Copied'} ${res.count} object${res.count === 1 ? '' : 's'}`, `→ s3://${targets.find((b) => b.id === destBucketId)?.name}/${dp}`);
      onDone(); onClose();
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  };
  return (
    <Modal open onClose={onClose} title={`${mode === 'move' ? 'Move' : 'Copy'} ${keys.length === 1 ? baseName(keys[0]) : `${keys.length} items`}`} description="Server-side copy — data never leaves the storage cluster."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>{mode === 'move' ? 'Move' : 'Copy'}</Button></>}>
      <div className="space-y-4">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'copy', label: 'Copy' }, { value: 'move', label: 'Move' }]} />
        <Field label="Destination bucket"><Select value={destBucketId} onChange={(e) => setDestBucketId(e.target.value)} options={targets.map((b) => ({ value: b.id, label: `${b.name}${b.id === bucket.id ? ' (this bucket)' : ''} · ${b.locationId}` }))} /></Field>
        <Field label="Destination folder" error={err} hint={`Result: s3://${targets.find((b) => b.id === destBucketId)?.name ?? ''}/${dp}${baseName(keys[0])}${keys[0].endsWith('/') ? '/…' : ''}`}>
          <Input value={destPrefix} onChange={(e) => setDestPrefix(e.target.value)} placeholder="(bucket root)" mono />
        </Field>
      </div>
    </Modal>
  );
}

function PresignModal({ bucket, objectKey, onClose }: { bucket: Bucket; objectKey: string; onClose: () => void }) {
  const [expiresIn, setExpiresIn] = useState('3600');
  const [method, setMethod] = useState<'GET' | 'PUT'>('GET');
  const [res, setRes] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const gen = async () => {
    setBusy(true);
    try { setRes(await api.action('buckets', bucket.id, 'presign', { key: objectKey, expiresIn: Number(expiresIn), method })) }
    catch (e) { toast.error('Could not sign URL', (e as Error).message) } finally { setBusy(false) }
  };
  return (
    <Modal open onClose={onClose} size="lg" title="Presigned URL" description={<>Temporary, signed link to <span className="font-mono">{objectKey}</span> — works without credentials until it expires.</>}
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" icon={Link2} loading={busy} onClick={gen}>{res ? 'Regenerate' : 'Generate URL'}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-4 @min-[36rem]:grid-cols-2">
          <Field label="Expires after"><Select value={expiresIn} onChange={(e) => { setExpiresIn(e.target.value); setRes(null) }} options={[{ value: '300', label: '5 minutes' }, { value: '3600', label: '1 hour' }, { value: '86400', label: '24 hours' }, { value: '604800', label: '7 days (maximum)' }]} /></Field>
          <Field label="Allowed operation"><Segmented value={method} onChange={(v) => { setMethod(v); setRes(null) }} options={[{ value: 'GET', label: 'Download (GET)' }, { value: 'PUT', label: 'Upload (PUT)' }]} /></Field>
        </div>
        {res && <>
          <CodeBlock code={res.url} wrap title={`Valid until ${dateTime(res.expiresAt)}`} />
          <CodeBlock language="bash" title="Use it" code={method === 'GET' ? `curl -o "${baseName(objectKey)}" "${res.url}"` : `curl -X PUT --upload-file ./${baseName(objectKey)} "${res.url}"`} wrap />
        </>}
      </div>
    </Modal>
  );
}
