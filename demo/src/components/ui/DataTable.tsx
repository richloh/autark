import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Checkbox } from './form';
import { Button } from './Button';
import { EmptyState, Skeleton } from './misc';
import { useUi } from '@/store/ui';

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** value used for sorting; omit to make column unsortable */
  sort?: (row: T) => string | number;
  className?: string;
  headerClassName?: string;
  /** hide on narrow screens */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export interface BulkAction<T> { label: string; icon?: LucideIcon; danger?: boolean; onClick: (rows: T[]) => void | Promise<void> }

export interface DataTableProps<T extends { id: string }> {
  rows: T[];
  columns: Column<T>[];
  loading?: boolean;
  /** text to search on (enables search box) */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  /** extra filter controls rendered next to search */
  toolbar?: ReactNode;
  rowLink?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  bulkActions?: BulkAction<T>[];
  empty?: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode };
  pageSize?: number;
  defaultSort?: { id: string; dir: 'asc' | 'desc' };
  className?: string;
  /** render a right-aligned actions cell (menus etc) */
  rowActions?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string | undefined;
  /** controlled search (e.g. from URL) */
  initialSearch?: string;
}

const HIDE = { sm: 'hidden @min-[36rem]:table-cell', md: 'hidden @min-[40rem]:table-cell', lg: 'hidden @min-[44rem]:table-cell', xl: 'hidden @min-[60rem]:table-cell' };

export function DataTable<T extends { id: string }>({
  rows, columns, loading, searchText, searchPlaceholder = 'Search…', toolbar, rowLink, onRowClick, bulkActions, empty, pageSize = 25, defaultSort, className, rowActions, rowClassName, initialSearch = '',
}: DataTableProps<T>) {
  const navigate = useNavigate();
  const density = useUi((s) => s.density);
  const [q, setQ] = useState(initialSearch);
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let r = rows;
    if (q && searchText) {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      r = r.filter((row) => { const t = searchText(row).toLowerCase(); return terms.every((term) => t.includes(term)) });
    }
    if (sort) {
      const col = columns.find((c) => c.id === sort.id);
      if (col?.sort) {
        const f = col.sort;
        r = [...r].sort((a, b) => {
          const x = f(a), y = f(b);
          const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          return sort.dir === 'asc' ? cmp : -cmp;
        });
      }
    }
    return r;
  }, [rows, q, sort, columns, searchText]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const visible = filtered.slice(cur * pageSize, cur * pageSize + pageSize);
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.id));
  const someSelected = visible.some((r) => selected.has(r.id));
  const pad = density === 'compact' ? 'py-1.5' : 'py-2.5';

  const toggleSort = (id: string) => setSort((s) => (s?.id !== id ? { id, dir: 'asc' } : s.dir === 'asc' ? { id, dir: 'desc' } : null));

  return (
    <div className={cn('overflow-hidden rounded-xl border border-line bg-surface shadow-card', className)}>
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-2.5">
          {searchText && (
            <div className="relative min-w-48 flex-1 @min-[36rem]:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0) }}
                placeholder={searchPlaceholder}
                className="h-8 w-full rounded-lg border border-line bg-surface-2/60 pl-8 pr-7 text-[13px] outline-none placeholder:text-faint focus:border-brand-500 focus:bg-surface"
              />
              {q && <button onClick={() => setQ('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-faint hover:text-fg" aria-label="Clear search"><X className="size-3.5" /></button>}
            </div>
          )}
          {toolbar}
          <div className="ml-auto text-xs text-muted tabular">{filtered.length === rows.length ? `${rows.length} items` : `${filtered.length} of ${rows.length}`}</div>
        </div>
      )}

      {bulkActions && selectedRows.length > 0 && (
        <div className="flex animate-in items-center gap-2 border-b border-brand-500/20 bg-brand-500/[0.06] px-3 py-2">
          <span className="text-[13px] font-medium text-fg">{selectedRows.length} selected</span>
          <div className="mx-2 h-4 w-px bg-line" />
          {bulkActions.map((a) => (
            <Button key={a.label} size="xs" variant={a.danger ? 'outline-danger' : 'secondary'} icon={a.icon} onClick={async () => { await a.onClick(selectedRows); setSelected(new Set()) }}>{a.label}</Button>
          ))}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-muted hover:text-fg">Clear</button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-[13px]">
          <thead>
            <tr className="border-b border-line bg-surface-2/50">
              {bulkActions && (
                <th className="w-10 px-3 py-2">
                  <Checkbox checked={allVisibleSelected} indeterminate={!allVisibleSelected && someSelected} onChange={(v) => {
                    const n = new Set(selected);
                    visible.forEach((r) => (v ? n.add(r.id) : n.delete(r.id)));
                    setSelected(n);
                  }} />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.id} style={{ width: c.width }} className={cn('whitespace-nowrap px-3 py-2 text-xs font-medium text-muted', c.hideBelow && HIDE[c.hideBelow], c.align === 'right' && 'text-right', c.headerClassName)}>
                  {c.sort ? (
                    <button onClick={() => toggleSort(c.id)} className={cn('inline-flex items-center gap-1 hover:text-fg', c.align === 'right' && 'flex-row-reverse')}>
                      {c.header}
                      {sort?.id === c.id ? (sort.dir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <span className="size-3" />}
                    </button>
                  ) : c.header}
                </th>
              ))}
              {rowActions && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 && Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {bulkActions && <td className="px-3 py-3"><Skeleton className="size-4" /></td>}
                {columns.map((c) => <td key={c.id} className={cn('px-3 py-3', c.hideBelow && HIDE[c.hideBelow])}><Skeleton className="w-3/4" /></td>)}
                {rowActions && <td />}
              </tr>
            ))}
            {visible.map((row) => {
              const link = rowLink?.(row);
              const clickable = !!link || !!onRowClick;
              return (
                <tr
                  key={row.id}
                  onClick={clickable ? (e) => {
                    if ((e.target as HTMLElement).closest('a,button,input,[role=checkbox],[role=button]')) return;
                    if (link) { if (e.metaKey || e.ctrlKey) window.open(link, '_blank'); else navigate(link) }
                    else onRowClick?.(row);
                  } : undefined}
                  className={cn('group border-b border-line transition-colors last:border-0', clickable && 'cursor-pointer hover:bg-surface-2/70', selected.has(row.id) && 'bg-brand-500/[0.04]', rowClassName?.(row))}
                >
                  {bulkActions && (
                    <td className={cn('px-3', pad)}>
                      <Checkbox checked={selected.has(row.id)} onChange={(v) => { const n = new Set(selected); v ? n.add(row.id) : n.delete(row.id); setSelected(n) }} />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.id} className={cn('px-3 align-middle', pad, c.hideBelow && HIDE[c.hideBelow], c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}>{c.cell(row)}</td>
                  ))}
                  {rowActions && <td className={cn('px-2 text-right', pad)}>{rowActions(row)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && filtered.length === 0 && (
        q ? <EmptyState icon={Search} title="No matches" description={`Nothing matches “${q}”.`} action={<Button size="sm" onClick={() => setQ('')}>Clear search</Button>} />
          : empty ? <EmptyState {...empty} /> : <EmptyState title="Nothing here yet" />
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-line px-3 py-2 text-xs text-muted">
          <span className="tabular">{cur * pageSize + 1}–{Math.min(filtered.length, (cur + 1) * pageSize)} of {filtered.length}</span>
          <div className="flex items-center gap-1">
            <button disabled={cur === 0} onClick={() => setPage(cur - 1)} className="rounded-md p-1 hover:bg-surface-2 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="size-4" /></button>
            <span className="tabular">{cur + 1} / {pages}</span>
            <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)} className="rounded-md p-1 hover:bg-surface-2 disabled:opacity-40" aria-label="Next page"><ChevronRight className="size-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small filter chip toggles for table toolbars. */
export function FilterChips<T extends string>({ options, value, onChange }: { options: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn('inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors', value === o.value ? 'bg-fg text-bg' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
          {o.label}
          {o.count != null && <span className={cn('tabular', value === o.value ? 'opacity-70' : 'text-faint')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}
