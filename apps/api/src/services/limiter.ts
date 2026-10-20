/** Caps concurrent jobs (FIFO queue), since image work is CPU- and memory-bound. */
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
