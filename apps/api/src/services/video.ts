import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '../errors/app-error.js';

export type VideoContainer = 'mp4' | 'mov' | 'webm';

export interface VideoLimits {
  ffmpegPath: string;
  timeoutMs: number;
  maxPixels: number;
}

export interface ExtractedFrame {
  png: Buffer;
  container: VideoContainer;
  durationSeconds: number | undefined;
}

const MAX_FRAME_BYTES = 100 * 1024 * 1024;
const STDERR_TAIL_BYTES = 16 * 1024;

/** From the bytes, since extensions lie: "ftyp" at byte 4 (MP4/MOV) or the EBML magic (WebM). */
export function detectVideoContainer(data: Buffer): VideoContainer | undefined {
  if (data.length >= 12 && data.toString('latin1', 4, 8) === 'ftyp') {
    return data.toString('latin1', 8, 12) === 'qt  ' ? 'mov' : 'mp4';
  }
  if (data.length >= 4 && data.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  return undefined;
}

export function parseDuration(log: string): number | undefined {
  const match = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(log);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

interface FfmpegResult {
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}

function runFfmpeg(path: string, args: string[], timeoutMs: number): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    // No shell: arguments are passed as-is, so nothing in them can be interpreted.
    const child = spawn(path, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let outBytes = 0;
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > MAX_FRAME_BYTES) child.kill('SIGKILL');
      else chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_BYTES);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(chunks), stderr, timedOut });
    });
  });
}

/**
 * Writes the video to a temp dir (MP4 indexes are often at the end, so ffmpeg
 * must seek) and restricts ffmpeg to local files, so a crafted file can't make it fetch URLs.
 */
export async function extractFrame(
  input: Buffer,
  timeSeconds: number,
  limits: VideoLimits,
): Promise<ExtractedFrame> {
  const container = detectVideoContainer(input);
  if (!container) {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      'The source URL did not return a supported video. Supported: MP4, MOV, WebM',
    );
  }

  const dir = await mkdtemp(join(tmpdir(), 'ips-video-'));
  try {
    const file = join(dir, `input.${container}`);
    await writeFile(file, input);

    const result = await runFfmpeg(
      limits.ffmpegPath,
      [
        '-hide_banner',
        '-nostdin',
        '-protocol_whitelist',
        'file',
        '-max_pixels',
        String(limits.maxPixels),
        // -ss before -i seeks on the input: fast, and lands on the nearest frame.
        '-ss',
        String(timeSeconds),
        '-i',
        file,
        '-frames:v',
        '1',
        '-an',
        '-sn',
        '-dn',
        '-f',
        'image2pipe',
        '-c:v',
        'png',
        'pipe:1',
      ],
      limits.timeoutMs,
    );

    if (result.timedOut) {
      throw new AppError(
        'UNPROCESSABLE_VIDEO',
        `The video took longer than ${limits.timeoutMs / 1000}s to decode`,
      );
    }

    const durationSeconds = parseDuration(result.stderr);
    if (result.stdout.length === 0) {
      if (durationSeconds !== undefined && timeSeconds >= durationSeconds) {
        throw new AppError(
          'UNPROCESSABLE_VIDEO',
          `time=${timeSeconds} is past the end of the video, which is ${durationSeconds.toFixed(2)}s long`,
          'time',
        );
      }
      throw new AppError(
        'UNPROCESSABLE_VIDEO',
        'Could not decode a frame from the video; it may be corrupt, use an unsupported codec, or exceed the resolution limit',
      );
    }

    return { png: result.stdout, container, durationSeconds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
