import { useMemo, useState } from 'react';
import { Globe2, Lock, PlugZap } from 'lucide-react';
import { Card, CardHeader } from '@/components/ui/Card';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Segmented } from '@/components/ui/Tabs';
import { Field, Select, Switch } from '@/components/ui/form';
import { CopyButton } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { ENGINE_META } from './engine';
import type { DbInstance } from '@/types';

type Fmt = 'cli' | 'uri' | 'jdbc' | 'env' | 'code';

/** Connection details + connection string builder (psql / mysql / redis-cli, URI, JDBC, env vars). */
export function ConnectionPanel({ d, simple }: { d: DbInstance; simple?: boolean }) {
  const meta = ENGINE_META[d.engine];
  const redis = d.engine === 'redis';
  const [endpoint, setEndpoint] = useState<'private' | 'public'>('private');
  const [user, setUser] = useState(d.users.find((u) => u.role !== 'owner')?.username ?? d.users[0]?.username ?? '');
  const [dbName, setDbName] = useState(d.databases[0]?.name ?? (redis ? 'db0' : ''));
  const [pooled, setPooled] = useState(d.engine === 'postgres');
  const [fmt, setFmt] = useState<Fmt>('cli');
  const host = endpoint === 'public' && d.publicHost ? d.publicHost : d.host;
  const port = d.engine === 'postgres' && pooled ? 6432 : d.port;
  const pw = '<PASSWORD>';

  const snippets = useMemo<Record<Fmt, { code: string; lang: string; label: string } | null>>(() => {
    const dbIndex = dbName.replace(/^db/, '') || '0';
    if (redis) return {
      cli: { label: 'redis-cli', lang: 'bash', code: `redis-cli -h ${host} -p ${port} --tls \\\n  --user ${user} --pass '${pw}' -n ${dbIndex}` },
      uri: { label: 'URI', lang: 'text', code: `rediss://${user}:${pw}@${host}:${port}/${dbIndex}` },
      jdbc: null,
      env: { label: 'Env vars', lang: 'bash', code: `REDIS_URL=rediss://${user}:${pw}@${host}:${port}/${dbIndex}\nREDIS_HOST=${host}\nREDIS_PORT=${port}\nREDIS_USERNAME=${user}\nREDIS_PASSWORD=${pw}\nREDIS_TLS=true` },
      code: { label: 'Node (ioredis)', lang: 'ts', code: `import Redis from 'ioredis';\n\nconst redis = new Redis({\n  host: '${host}', port: ${port}, db: ${dbIndex},\n  username: '${user}', password: process.env.REDIS_PASSWORD,\n  tls: { servername: '${host}' },\n});` },
    };
    if (d.engine === 'postgres') return {
      cli: { label: 'psql', lang: 'bash', code: `psql "host=${host} port=${port} dbname=${dbName} \\\n  user=${user} sslmode=verify-full sslrootcert=autark-db-ca.pem"` },
      uri: { label: 'URI', lang: 'text', code: `postgresql://${user}:${pw}@${host}:${port}/${dbName}?sslmode=require` },
      jdbc: { label: 'JDBC', lang: 'text', code: `jdbc:postgresql://${host}:${port}/${dbName}?user=${user}&password=${pw}&ssl=true&sslmode=require${pooled ? '&prepareThreshold=0' : ''}` },
      env: { label: 'Env vars', lang: 'bash', code: `PGHOST=${host}\nPGPORT=${port}\nPGDATABASE=${dbName}\nPGUSER=${user}\nPGPASSWORD=${pw}\nPGSSLMODE=require\nDATABASE_URL=postgresql://${user}:${pw}@${host}:${port}/${dbName}?sslmode=require` },
      code: null,
    };
    return {
      cli: { label: meta.cli, lang: 'bash', code: `${meta.cli} -h ${host} -P ${port} -u ${user} -p \\\n  --ssl-mode=REQUIRED ${dbName}` },
      uri: { label: 'URI', lang: 'text', code: `mysql://${user}:${pw}@${host}:${port}/${dbName}?ssl-mode=REQUIRED` },
      jdbc: { label: 'JDBC', lang: 'text', code: `jdbc:${d.engine === 'mariadb' ? 'mariadb' : 'mysql'}://${host}:${port}/${dbName}?user=${user}&password=${pw}&sslMode=REQUIRED` },
      env: { label: 'Env vars', lang: 'bash', code: `MYSQL_HOST=${host}\nMYSQL_PORT=${port}\nMYSQL_DATABASE=${dbName}\nMYSQL_USER=${user}\nMYSQL_PASSWORD=${pw}\nDATABASE_URL=mysql://${user}:${pw}@${host}:${port}/${dbName}` },
      code: null,
    };
  }, [redis, host, port, user, dbName, pooled, d.engine, meta.cli]);

  const fmts = (Object.keys(snippets) as Fmt[]).filter((k) => snippets[k]);
  const active = snippets[fmt] ?? snippets[fmts[0]]!;
  const endpointToggle = d.publicAccess && d.publicHost ? (
    <Segmented size="sm" value={endpoint} onChange={setEndpoint} options={[{ value: 'private', label: 'Private', icon: <Lock className="size-3" /> }, { value: 'public', label: 'Public', icon: <Globe2 className="size-3" /> }]} />
  ) : undefined;

  if (simple) {
    const uri = snippets.uri!.code;
    return (
      <Card>
        <CardHeader icon={PlugZap} title="Connect" actions={endpointToggle} />
        <div className="space-y-3 p-4">
          <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2.5">
            <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed text-fg">{uri}</code>
            <CopyButton value={uri} />
          </div>
          <p className="text-xs text-muted">
            Replace <code className="font-mono text-fg-2">{pw}</code> with the password for <b className="font-medium text-fg-2">{user}</b>. Connections are always encrypted (TLS).
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader icon={PlugZap} title="Connect" description="TLS is always required. Passwords are never shown here — substitute your own." actions={endpointToggle} />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-2 @min-[36rem]:grid-cols-[minmax(0,1fr)_90px]">
          <div className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2">
            <div className="min-w-0"><div className="text-[11px] text-muted">Host</div><div className="truncate font-mono text-[13px] text-fg">{host}</div></div>
            <CopyButton value={host} />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2/60 px-3 py-2">
            <div><div className="text-[11px] text-muted">Port</div><div className="font-mono text-[13px] text-fg">{port}</div></div>
            <CopyButton value={String(port)} />
          </div>
        </div>
        <div className={cn('grid gap-3', d.engine === 'postgres' ? '@min-[36rem]:grid-cols-3' : '@min-[36rem]:grid-cols-2')}>
          <Field label="User"><Select value={user} onChange={(e) => setUser(e.target.value)} options={d.users.map((u) => ({ value: u.username, label: `${u.username} (${u.role})` }))} /></Field>
          <Field label={redis ? 'Logical DB' : 'Database'}>
            <Select value={dbName} onChange={(e) => setDbName(e.target.value)} options={(redis ? Array.from({ length: 16 }, (_, i) => ({ name: `db${i}` })) : d.databases).map((x) => ({ value: x.name, label: x.name }))} placeholder={!redis && !d.databases.length ? 'No databases' : undefined} />
          </Field>
          {d.engine === 'postgres' && (
            <div className="flex items-end pb-1.5"><Switch size="sm" checked={pooled} onChange={setPooled} label={<span className="text-[13px]">PgBouncer pool</span>} description="Port 6432, transaction mode" /></div>
          )}
        </div>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted">Connection string</span>
            <Segmented size="sm" value={fmts.includes(fmt) ? fmt : fmts[0]} onChange={setFmt} options={fmts.map((f) => ({ value: f, label: snippets[f]!.label }))} />
          </div>
          <CodeBlock code={active.code} language={active.lang} maxHeight="max-h-56" wrap />
        </div>
      </div>
    </Card>
  );
}
