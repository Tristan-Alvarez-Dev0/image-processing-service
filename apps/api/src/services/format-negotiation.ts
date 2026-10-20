import type { OutputFormat } from '../schemas/process.js';

export interface AcceptedFormats {
  avif: boolean;
  webp: boolean;
}

/**
 * Reads which modern formats the client explicitly supports. Wildcards
 * (`image/*`, `*\/*`) are ignored on purpose: browsers send them even when
 * they cannot decode AVIF, so only an explicit `image/avif` counts.
 */
export function parseAccept(header: string | undefined): AcceptedFormats {
  const accepted = new Set<string>();
  for (const part of (header ?? '').split(',')) {
    const [type, ...params] = part.split(';').map((s) => s.trim().toLowerCase());
    const q = params.find((p) => p.startsWith('q='));
    if (type && (q === undefined || Number(q.slice(2)) > 0)) accepted.add(type);
  }
  return { avif: accepted.has('image/avif'), webp: accepted.has('image/webp') };
}

/**
 * Picks the smallest format the client can display:
 * AVIF > WebP > (PNG if the image has transparency, else JPEG).
 * Animations need a format that animates: WebP, else GIF.
 */
export function chooseAutoFormat(
  accepts: AcceptedFormats,
  source: { hasAlpha: boolean; animated: boolean },
): OutputFormat {
  if (source.animated) return accepts.webp ? 'webp' : 'gif';
  if (accepts.avif) return 'avif';
  if (accepts.webp) return 'webp';
  return source.hasAlpha ? 'png' : 'jpeg';
}
