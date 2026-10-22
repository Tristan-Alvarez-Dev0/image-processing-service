import type { ImageResult } from '@ips/sdk';
import { useEffect, useEffectEvent, useState } from 'react';
import type { PanelRequest } from '@/lib/playground';

export interface Loaded {
  result: ImageResult;
  /** Object URL for <img src>; revoked once replaced. */
  src: string;
}

export interface PanelState {
  loading: boolean;
  /** Kept while the next one loads, to avoid flicker. */
  data: Loaded | undefined;
  error: unknown;
}

interface Settled {
  id: string;
  data?: Loaded;
  error?: unknown;
}

/** Reloads on a new URL or run, cancelling the previous request so stale responses never win. */
export function useImage(request: PanelRequest | undefined): PanelState {
  const [settled, setSettled] = useState<Settled>();
  const id = request ? `${request.run}:${request.key}` : undefined;
  const load = useEffectEvent((signal: AbortSignal) => request!.load(signal));

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    load(controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setSettled({ id, data: { result, src: URL.createObjectURL(result.blob) } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setSettled({ id, error });
      },
    );
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    const src = settled?.data?.src;
    return () => {
      if (src) URL.revokeObjectURL(src);
    };
  }, [settled]);

  const current = settled?.id === id;
  return {
    loading: id !== undefined && !current,
    data: settled?.data,
    error: current ? settled?.error : undefined,
  };
}
