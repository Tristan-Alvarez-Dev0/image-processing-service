import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { loadConfig } from '../../src/config.js';

const run = promisify(execFile);

/** Generates small test videos with the bundled ffmpeg, so no binaries live in the repo. */
export async function makeVideoFixtures() {
  const ffmpeg = loadConfig({}).FFMPEG_PATH;
  const dir = await mkdtemp(join(tmpdir(), 'ips-fixtures-'));
  const make = async (name: string, args: string[]) => {
    const file = join(dir, name);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args, file]);
    return readFile(file);
  };
  const colour = (c: string, seconds: number) => `color=c=${c}:s=160x120:d=${seconds}:r=10`;

  try {
    const [redThenBlue, webm, mov] = await Promise.all([
      // 2s, 160x120: red for the first second, blue for the second.
      make('rb.mp4', [
        '-f',
        'lavfi',
        '-i',
        `${colour('red', 1)}[a];${colour('blue', 1)}[b];[a][b]concat=n=2:v=1:a=0`,
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
      ]),
      make('green.webm', ['-f', 'lavfi', '-i', colour('0x00FF00', 1), '-c:v', 'libvpx-vp9']),
      make('yellow.mov', [
        '-f',
        'lavfi',
        '-i',
        colour('yellow', 1),
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-f',
        'mov',
      ]),
    ]);

    // A valid MP4 signature followed by garbage.
    const corrupt = Buffer.concat([redThenBlue.subarray(0, 32), Buffer.alloc(2000, 7)]);
    const hlsPlaylist = Buffer.from('#EXTM3U\n#EXTINF:1,\nhttp://169.254.169.254/x.ts\n');

    return { redThenBlue, webm, mov, corrupt, hlsPlaylist };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
