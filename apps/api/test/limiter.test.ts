import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter } from '../src/services/limiter.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('ConcurrencyLimiter', () => {
  it('never runs more than `max` jobs at once and runs them all', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let running = 0;
    let peak = 0;
    const started: number[] = [];

    const results = await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        limiter.run(async () => {
          started.push(i);
          running++;
          peak = Math.max(peak, running);
          await tick();
          running--;
          return i * 10;
        }),
      ),
    );

    expect(peak).toBe(2);
    expect(results).toEqual([0, 10, 20, 30, 40]);
    expect(started).toEqual([0, 1, 2, 3, 4]); // FIFO
    expect(limiter.stats).toEqual({ active: 0, waiting: 0, max: 2 });
  });

  it('releases the slot when a job throws', async () => {
    const limiter = new ConcurrencyLimiter(1);

    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limiter.run(async () => 'ok')).resolves.toBe('ok');
    expect(limiter.stats.active).toBe(0);
  });

  it('reports queued jobs', async () => {
    const limiter = new ConcurrencyLimiter(1);
    let release!: () => void;
    const first = limiter.run(() => new Promise<void>((r) => (release = r)));
    const second = limiter.run(async () => undefined);
    await tick();

    expect(limiter.stats).toEqual({ active: 1, waiting: 1, max: 1 });
    release();
    await Promise.all([first, second]);
  });
});
