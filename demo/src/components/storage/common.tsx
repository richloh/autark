import { Globe, Lock, File, FileText, FileImage, FileCode2, FileArchive, FileJson, FileVideo, Folder, Database, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { PRICING } from '@/lib/pricing';
import { bytes } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Bucket, StorageClass } from '@/types';

export const GB = 1024 ** 3;

export const CLASS_META: Record<StorageClass, { label: string; short: string; color: string; description: string; retrieval: string; price: number }> = {
  STANDARD: { label: 'Standard', short: 'STD', color: '#5b67f8', description: 'Hot data, frequent access. NVMe-backed index, erasure-coded HDD/SSD data.', retrieval: 'Instant · ~15 ms TTFB', price: PRICING.objectStorage.STANDARD },
  INFREQUENT: { label: 'Infrequent access', short: 'IA', color: '#06b6d4', description: 'Backups, logs, data read less than once a month.', retrieval: 'Instant · ~40 ms TTFB', price: PRICING.objectStorage.INFREQUENT },
  ARCHIVE: { label: 'Archive', short: 'ARC', color: '#a855f7', description: 'Long-term retention on dense HDD pools. Compliance & cold archives.', retrieval: 'Minutes (restore first)', price: PRICING.objectStorage.ARCHIVE },
};

export function ClassBadge({ value, className }: { value: StorageClass; className?: string }) {
  const m = CLASS_META[value];
  return (
    <span className={cn('inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md bg-surface-2 px-2 text-xs font-medium text-fg-2 ring-1 ring-inset ring-line', className)}>
      <span className="size-2 rounded-sm" style={{ background: m.color }} />{m.label}
    </span>
  );
}

export function AccessBadge({ access }: { access: Bucket['access'] }) {
  return access === 'public-read'
    ? <Badge tone="warning" title="Anyone on the internet can read objects in this bucket"><Globe className="size-3" />Public</Badge>
    : <Badge tone="neutral"><Lock className="size-3" />Private</Badge>;
}

/** Usage bar against the bucket quota (or just a size label when unlimited). */
export function UsageBar({ bucket, className }: { bucket: Bucket; className?: string }) {
  const quota = bucket.quotaGB ? bucket.quotaGB * GB : null;
  const ratio = quota ? Math.min(1, bucket.bytesUsed / quota) : null;
  const color = ratio == null ? 'bg-brand-500/60' : ratio >= 0.9 ? 'bg-rose-500' : ratio >= 0.75 ? 'bg-amber-500' : 'bg-brand-500';
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="tabular font-medium text-fg">{bytes(bucket.bytesUsed)}</span>
        <span className="tabular text-muted">{quota ? `of ${bucket.quotaGB! >= 1024 ? `${(bucket.quotaGB! / 1024).toFixed(bucket.quotaGB! % 1024 ? 1 : 0)} TB` : `${bucket.quotaGB} GB`}` : 'no quota'}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
        <div className={cn('h-full rounded-full transition-all duration-500', color)} style={{ width: `${ratio == null ? Math.min(100, 8 + Math.log10(1 + bucket.bytesUsed / GB) * 22) : ratio * 100}%` }} />
      </div>
    </div>
  );
}

export function objectIcon(contentType: string, isFolder = false): { icon: LucideIcon; color: string } {
  if (isFolder) return { icon: Folder, color: '#eab308' };
  if (contentType.startsWith('image/')) return { icon: FileImage, color: '#10b981' };
  if (contentType.startsWith('video/')) return { icon: FileVideo, color: '#ec4899' };
  if (contentType.includes('json')) return { icon: FileJson, color: '#f59e0b' };
  if (/javascript|css|html|xml|yaml/.test(contentType)) return { icon: FileCode2, color: '#5b67f8' };
  if (contentType.startsWith('text/')) return { icon: FileText, color: '#64748b' };
  if (/gzip|zip|tar|compressed/.test(contentType)) return { icon: FileArchive, color: '#a855f7' };
  if (/sql|dump|parquet/.test(contentType)) return { icon: Database, color: '#06b6d4' };
  return { icon: File, color: '#94a3b8' };
}

export const isTextual = (ct: string) => ct.startsWith('text/') || /json|javascript|xml|yaml|svg|csv|markdown/.test(ct);

/** Trigger a browser download of a string / data URL. */
export function downloadFile(filename: string, content: string, type = 'text/plain') {
  const href = content.startsWith('data:') ? content : URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (!content.startsWith('data:')) setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export const BUCKET_NAME_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
export function bucketNameHint(name: string): string | null {
  if (!name) return null;
  if (name.length < 3) return 'At least 3 characters';
  if (name.length > 63) return 'At most 63 characters';
  if (!BUCKET_NAME_RE.test(name)) return 'Lowercase letters, digits, dots, dashes; start/end alphanumeric';
  if (/\.\.|\.-|-\./.test(name)) return 'No adjacent dots, or dots next to dashes';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return 'Must not look like an IP address';
  return null;
}
