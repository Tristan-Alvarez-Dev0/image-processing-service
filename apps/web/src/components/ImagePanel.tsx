import type { PanelState } from '../hooks.js';
import { describeError, formatBytes, sizeChange } from '../lib.js';

interface Props {
  title: string;
  subtitle: string;
  state: PanelState;
  /** Show the true source details (from X-Original-* headers) instead of the returned image's. */
  showSource?: boolean;
  /** Original size in bytes, to compare against. */
  compareTo?: number | undefined;
  empty: boolean;
}

export function ImagePanel({ title, subtitle, state, showSource, compareTo, empty }: Props) {
  const result = state.data?.result;
  const error = state.error ? describeError(state.error) : undefined;

  return (
    <section className="panel" aria-labelledby={`${title}-title`} aria-busy={state.loading}>
      <header className="panel__header">
        <h2 id={`${title}-title`}>{title}</h2>
        <span className="panel__subtitle">{subtitle}</span>
      </header>

      <div className={`panel__stage${state.loading ? ' panel__stage--loading' : ''}`}>
        {empty ? (
          <p className="panel__empty">Enter a URL or pick a sample to start.</p>
        ) : error ? (
          <div className="panel__error" role="status">
            <strong>{error.title}</strong>
            <span>{error.code}</span>
          </div>
        ) : state.data ? (
          <img src={state.data.src} alt={`${title} result`} />
        ) : (
          <p className="panel__empty">Loading…</p>
        )}
        {state.loading && <div className="spinner" aria-label="Loading" />}
      </div>

      {result && !error && !empty && (
        <dl className="meta">
          {showSource ? (
            <>
              <dt>Dimensions</dt>
              <dd>
                {result.original.width} × {result.original.height}
              </dd>
              <dt>Format</dt>
              <dd>{result.original.format}</dd>
              <dt>Size</dt>
              <dd>{formatBytes(result.original.size)}</dd>
              {result.original.duration !== undefined && (
                <>
                  <dt>Duration</dt>
                  <dd>{result.original.duration.toFixed(2)} s</dd>
                </>
              )}
            </>
          ) : (
            <>
              <dt>Dimensions</dt>
              <dd>
                {result.width} × {result.height}
              </dd>
              <dt>Format</dt>
              <dd>{result.contentType.replace('image/', '')}</dd>
              <dt>Size</dt>
              <dd>
                {formatBytes(result.size)}
                {compareTo !== undefined && (
                  <span className="meta__delta"> ({sizeChange(result.size, compareTo)})</span>
                )}
              </dd>
              <dt>Cache</dt>
              <dd>
                <span className={`badge badge--${result.cache === 'HIT' ? 'hit' : 'miss'}`}>
                  {result.cache ?? 'n/a'}
                </span>
              </dd>
              <dt>Request ID</dt>
              <dd className="mono">{result.requestId}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
