import { useRouteError, Link } from 'react-router';
import { AlertOctagon } from 'lucide-react';

export function RouteError() {
  const err = useRouteError() as Error | undefined;
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-pop">
        <AlertOctagon className="size-8 text-rose-500" />
        <h1 className="mt-3 text-lg font-semibold text-fg">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted">The console hit an unexpected error while rendering this page.</p>
        <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 text-xs text-rose-600">{err?.message ?? String(err)}</pre>
        <Link to="/dashboard" className="mt-4 inline-block text-sm font-medium text-brand-500 hover:underline">Back to dashboard</Link>
      </div>
    </div>
  );
}
