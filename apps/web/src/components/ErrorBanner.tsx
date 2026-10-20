import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { describeError } from '@/lib/playground';

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = describeError(error);
  return (
    <Alert variant="destructive" data-testid="error-banner">
      <AlertCircle />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        {e.title}
        <code className="rounded bg-destructive/15 px-1.5 py-0.5 text-[11px]">{e.code}</code>
        {e.param && (
          <span className="text-xs font-normal">
            on{' '}
            <code className="rounded bg-destructive/15 px-1.5 py-0.5 text-[11px]">{e.param}</code>
          </span>
        )}
      </AlertTitle>
      <AlertDescription>
        <p>{e.message}</p>
        {e.requestId && <p className="font-mono text-xs opacity-70">Request ID: {e.requestId}</p>}
      </AlertDescription>
    </Alert>
  );
}
