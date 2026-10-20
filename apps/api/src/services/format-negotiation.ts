import type { OutputFormat } from '../schemas/process.js';

export interface AcceptedFormats {
  avif: boolean;
  webp: boolean;
}

/** Wildcards are ignored: browsers send them even when they can't decode AVIF. */
export function parseAccept(header: string | undefined): AcceptedFormats {
  const accepted = new Set<string>();
  for (const part of (header ?? '').split(',')) {
    const [type, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    const q = params.find((p) => p.startsWith('q='));
    if (type && (q === undefined || Number(q.slice(2)) > 0)) accepted.add(type);
  }
  return { avif: accepted.has('image/avif'), webp: accepted.has('image/webp') };
}

/** AVIF > WebP > PNG (with alpha) or JPEG. Animations need WebP or GIF. */
export function chooseAutoFormat(
  accepts: AcceptedFormats,
  source: { hasAlpha: boolean; animated: boolean },
): OutputFormat {
  if (source.animated) return accepts.webp ? 'webp' : 'gif';
  if (accepts.avif) return 'avif';
  if (accepts.webp) return 'webp';
  return source.hasAlpha ? 'png' : 'jpeg';
}
