import { BookOpen, FileJson } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Controls } from '@/components/Controls';
import { ErrorBanner } from '@/components/ErrorBanner';
import { ImagePanel } from '@/components/ImagePanel';
import { RequestBar } from '@/components/RequestBar';
import { RunBar } from '@/components/RunBar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { useImage } from '@/hooks';
import {
  API_URL,
  client,
  DEFAULT_FORM,
  describeError,
  prepareRequest,
  TRANSFORM_DEFAULTS,
  type FormState,
} from '@/lib/playground';

interface Applied {
  form: FormState;
  run: number;
}

const isSameForm = (a: FormState, b: FormState) =>
  (Object.keys(a) as Array<keyof FormState>).every((k) => a[k] === b[k]);

export function App() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [version, setVersion] = useState<string | null>();

  useEffect(() => {
    client.health().then(
      (h) => setVersion(h.version),
      () => setVersion(null),
    );
  }, []);

  // Editing changes `form`; the API only sees `applied`, set on button press or Enter.
  const [applied, setApplied] = useState<Applied>();
  const request = useMemo(() => applied && prepareRequest(applied.form, applied.run), [applied]);
  const original = useImage(request?.original);
  const processed = useImage(request?.processed);
  const running = original.loading || processed.loading;
  const dirty = applied !== undefined && !isSameForm(form, applied.form);
  const resultsRef = useRef<HTMLDivElement>(null);

  const run = () => {
    if (!form.url.trim()) return;
    setApplied((prev) => ({ form, run: (prev?.run ?? 0) + 1 }));
    if (window.matchMedia('(max-width: 1023px)').matches) {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // A source problem fails both panels with the same error; show it once.
  const error = processed.error ?? original.error;
  const errorInfo = error ? describeError(error) : undefined;
  const isEmpty = !request;
  const isVideo = request?.mode === 'video';

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    // Desktop: one screen tall and each column scrolls, so the run button stays visible.
    // The scrollers are `relative` so the dropdown's hidden <select> can't stretch the page.
    <div className="mx-auto flex max-w-[1440px] flex-col px-4 py-6 sm:px-6 lg:h-dvh">
      <header className="mb-6 flex shrink-0 flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Image Processing Playground</h1>
          <p className="text-sm text-muted-foreground">
            Resize, crop and convert images, or grab a frame from a video.
          </p>
        </div>
        <nav className="flex items-center gap-2">
          {version !== undefined && (
            <Badge
              variant="outline"
              className={version ? 'gap-1.5 text-emerald-400' : 'gap-1.5 text-destructive'}
            >
              <span
                className={`size-1.5 rounded-full ${version ? 'bg-emerald-400' : 'bg-destructive'}`}
              />
              {version ? `API v${version}` : 'API offline'}
            </Badge>
          )}
          <Button asChild variant="ghost" size="sm">
            <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
              <BookOpen /> API docs
            </a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={`${API_URL}/openapi.json`} target="_blank" rel="noreferrer">
              <FileJson /> OpenAPI
            </a>
          </Button>
        </nav>
      </header>

      <main className="grid items-start gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[380px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
        <Card className="lg:min-h-0">
          <CardContent className="relative lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <Controls
              form={form}
              onChange={update}
              onSample={(s) => update({ url: s.url, mode: s.mode })}
              onRun={run}
              errorParam={dirty ? undefined : errorInfo?.param}
              errorMessage={errorInfo?.message}
            />
          </CardContent>
          <CardFooter className="border-t">
            <RunBar
              mode={form.mode}
              disabled={!form.url.trim()}
              running={running}
              dirty={dirty}
              onReset={() => update(TRANSFORM_DEFAULTS)}
            />
          </CardFooter>
        </Card>

        <div
          ref={resultsRef}
          className="relative flex min-w-0 scroll-mt-6 flex-col gap-4 *:shrink-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1"
        >
          <RequestBar path={request?.processed.key} isAuto={request?.isAuto ?? false} />
          <ErrorBanner error={error} />
          <div className="grid gap-4 md:grid-cols-2">
            <ImagePanel
              title="Original"
              description={isVideo ? 'The frame at the chosen time' : 'Your source, untouched'}
              state={original}
              showSource
              empty={isEmpty}
            />
            <ImagePanel
              title="Processed"
              description="The API's response to the request above"
              state={processed}
              compareTo={original.data?.result.original.size}
              empty={isEmpty}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
