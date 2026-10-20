import { describeError } from '../lib.js';

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = describeError(error);
  return (
    <div className="banner" role="alert" data-testid="error-banner">
      <div className="banner__title">
        {e.title} <code>{e.code}</code>
        {e.param && (
          <>
            {' '}
            on <code>{e.param}</code>
          </>
        )}
      </div>
      <p>{e.message}</p>
      {e.requestId && <p className="banner__meta">Request ID: {e.requestId}</p>}
    </div>
  );
}
