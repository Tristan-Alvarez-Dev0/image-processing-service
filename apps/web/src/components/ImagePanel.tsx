import { AlertTriangle, ImageIcon, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { PanelState } from '@/hooks';
import { describeError, formatBytes, sizeChange } from '@/lib/playground';

interface Props {
  title: string;
  description: string;
  state: PanelState;
  /** Show the true source details (from X-Original-* headers) instead of the returned image's. */
  showSource?: boolean;
  /** Original size in bytes, to compare against. */
  compareTo?: number | undefined;
  empty: boolean;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

export function ImagePanel({ title, description, state, showSource, compareTo, empty }: Props) {
  const result = state.data?.result;
  const error = state.error ? describeError(state.error) : undefined;
  const titleId = `${title.toLowerCase()}-title`;
  const show = result && !error && !empty;
  const change = show && compareTo !== undefined ? sizeChange(result.size, compareTo) : undefined;

  // The processed panel shows whether the API served it from cache.
  const badge =
    show && !showSource ? (
      <Badge
        variant="outline"
        className={
          result.cache === 'HIT'
            ? 'border-emerald-500/30 bg-emerald-500/10 font-mono text-emerald-400'
            : 'font-mono text-muted-foreground'
        }
        title={result.cache === 'HIT' ? 'Served from the API cache' : 'Freshly processed'}
      >
        {result.cache ?? 'n/a'}
      </Badge>
    ) : null;

  return (
    <Card role="region" aria-labelledby={titleId} aria-busy={state.loading} className="min-w-0">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle id={titleId}>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {badge}
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="checkerboard relative grid min-h-72 place-items-center overflow-hidden rounded-lg border p-3">
          {empty ? (
            <div className="flex flex-col items-center gap-2 rounded-md bg-background/80 px-4 py-3 text-center text-sm text-muted-foreground">
              <ImageIcon className="size-6" />
              Pick a source and press the button to start.
            </div>
          ) : error ? (
            <div
              role="status"
              className="flex flex-col items-center gap-1.5 rounded-md bg-background/90 px-4 py-3 text-center"
            >
              <AlertTriangle className="size-5 text-destructive" />
              <span className="text-sm font-medium text-destructive">{error.title}</span>
              <code className="text-xs text-muted-foreground">{error.code}</code>
            </div>
          ) : state.data ? (
            <img
              src={state.data.src}
              alt={`${title} result`}
              className={`max-h-[480px] max-w-full object-contain transition-opacity ${state.loading ? 'opacity-40' : ''}`}
            />
          ) : (
            <Skeleton className="absolute inset-3" />
          )}
          {state.loading && !empty && (
            <div className="absolute inset-0 grid place-items-center">
              <Loader2 className="size-7 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          )}
        </div>

        {show && (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(100px,1fr))] gap-2">
            {showSource ? (
              <>
                <Stat label="Dimensions">
                  {result.original.width} × {result.original.height}
                </Stat>
                <Stat label="Size">{formatBytes(result.original.size)}</Stat>
                <Stat label="Format">{result.original.format.toUpperCase()}</Stat>
                {result.original.duration !== undefined && (
                  <Stat label="Duration">{result.original.duration.toFixed(2)} s</Stat>
                )}
              </>
            ) : (
              <>
                <Stat label="Dimensions">
                  {result.width} × {result.height}
                </Stat>
                <Stat label="Size">{formatBytes(result.size)}</Stat>
                <Stat label="Format">{result.contentType.replace('image/', '').toUpperCase()}</Stat>
              </>
            )}
          </dl>
        )}

        {show && !showSource && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            {change && (
              <span
                className={
                  change.endsWith('smaller')
                    ? 'font-medium text-emerald-400'
                    : 'font-medium text-amber-400'
                }
              >
                {change} than the original
              </span>
            )}
            <span className="truncate font-mono" title="Request ID">
              {result.requestId}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
