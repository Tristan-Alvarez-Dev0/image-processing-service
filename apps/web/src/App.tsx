import { useEffect, useMemo, useState } from 'react';
import { Controls } from './components/Controls.js';
import { ErrorBanner } from './components/ErrorBanner.js';
import { ImagePanel } from './components/ImagePanel.js';
import { RequestBar } from './components/RequestBar.js';
import { useDebounced, useImage } from './hooks.js';
import {
  client,
  DEFAULT_FORM,
  describeError,
  prepareRequest,
  TRANSFORM_DEFAULTS,
  type FormState,
} from './lib.js';

/** Waits for typing and slider drags to settle before calling the API. */
const DEBOUNCE_MS = 400;

export function App() {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [version, setVersion] = useState<string>();

  useEffect(() => {
    client.health().then(
      (h) => setVersion(h.version),
      () => setVersion(undefined),
    );
  }, []);

  const settledForm = useDebounced(form, DEBOUNCE_MS);
  const request = useMemo(() => prepareRequest(settledForm), [settledForm]);
  const original = useImage(request?.original);
  const processed = useImage(request?.processed);

  // A source problem fails both panels with the same error; show it once.
  const error = processed.error ?? original.error;
  const described = error ? describeError(error) : undefined;
  const empty = !request;

  const update = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Image Processing Playground</h1>
          <p>
            Every change calls the public API through the TypeScript SDK; nothing here is a private
            endpoint.
          </p>
        </div>
        <nav className="topbar__links">
          <span className={`status ${version ? 'status--up' : 'status--down'}`}>
            {version ? `API v${version}` : 'API offline'}
          </span>
          <a href="/docs" target="_blank" rel="noreferrer">
            API docs
          </a>
          <a href="/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI
          </a>
        </nav>
      </header>

      <main className="layout">
        <aside>
          <Controls
            form={form}
            onChange={update}
            onReset={() => update(TRANSFORM_DEFAULTS)}
            onSample={(s) => update({ url: s.url, mode: s.mode })}
            errorParam={described?.param}
            errorMessage={described?.message}
          />
        </aside>

        <div className="results">
          <RequestBar path={request?.processed.key} negotiated={request?.negotiated ?? false} />
          <ErrorBanner error={error} />
          <div className="panels">
            <ImagePanel
              title="Original"
              subtitle={
                request?.mode === 'video'
                  ? 'Source video (frame shown at the chosen time)'
                  : 'Source, as reported by the API'
              }
              state={original}
              showSource
              empty={empty}
            />
            <ImagePanel
              title="Processed"
              subtitle="The response to the request above"
              state={processed}
              compareTo={original.data?.result.original.size}
              empty={empty}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
