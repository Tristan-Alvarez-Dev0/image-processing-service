/**
 * Caps how many jobs run at once; extra callers wait in FIFO order.
 * Image processing is CPU- and memory-bound, so unbounded parallelism makes
 * every request slower and risks running out of memory under load.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  get stats() {
    return { active: this.active, waiting: this.waiting.length, max: this.max };
  }

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active < this.max) {
      this.active++;
    } else {
      // The releasing job hands its slot straight to us, so `active` is unchanged.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
