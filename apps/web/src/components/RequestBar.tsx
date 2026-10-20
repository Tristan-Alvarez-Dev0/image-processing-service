import { useState } from 'react';
import { curlCommand } from '../lib.js';

interface Props {
  /** Path + query of the request, e.g. `/process?url=…`. */
  path: string | undefined;
  negotiated: boolean;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? 'Copied!' : label}
    </button>
  );
}

export function RequestBar({ path, negotiated }: Props) {
  if (!path) {
    return (
      <div className="request request--empty">
        The exact API request will appear here, ready to copy.
      </div>
    );
  }
  const url = new URL(path, window.location.origin).href;
  const curl = curlCommand(url, negotiated);

  return (
    <div className="request">
      <div className="request__line">
        <span className="request__method">GET</span>
        <code className="request__url" data-testid="request-url">
          {url}
        </code>
      </div>
      <div className="request__actions">
        <CopyButton text={url} label="Copy URL" />
        <CopyButton text={curl} label="Copy as curl" />
        <a className="button button--ghost" href={url} target="_blank" rel="noreferrer">
          Open
        </a>
      </div>
      {negotiated && (
        <p className="field__hint">
          format=auto depends on the Accept header, so the curl command sends one.
        </p>
      )}
    </div>
  );
}
