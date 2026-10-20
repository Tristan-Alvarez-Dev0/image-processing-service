import type { ImageResult } from '@ips/sdk';
import { useEffect, useEffectEvent, useState } from 'react';
import type { PanelRequest } from './lib.js';

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export interface Loaded {
  result: ImageResult;
  /** Object URL for <img src>; revoked once replaced. */
  src: string;
}

export interface PanelState {
  /** A request is in flight for the current key. */
  loading: boolean;
  /** The last successful image. Kept while the next one loads, to avoid flicker. */
  data: Loaded | undefined;
  /** The error for the current key, if it failed. */
  error: unknown;
}

interface Settled {
  key: string;
  data?: Loaded;
  error?: unknown;
}

/**
 * Loads the image for `request` whenever its key (the exact URL) changes,
 * cancelling the previous request so stale responses never win.
 */
export function useImage(request: PanelRequest | undefined): PanelState {
  const [settled, setSettled] = useState<Settled>();
  const key = request?.key;
  const load = useEffectEvent((signal: AbortSignal) => request!.load(signal));

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    load(controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setSettled({ key, data: { result, src: URL.createObjectURL(result.blob) } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setSettled({ key, error });
      },
    );
    return () => controller.abort();
  }, [key]);

  // Free the previous blob once a new result has replaced it.
  useEffect(() => {
    const src = settled?.data?.src;
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [settled]);

  const current = settled?.key === key;
  return {
    loading: key !== undefined && !current,
    data: settled?.data,
    error: current ? settled?.error : undefined,
  };
}
