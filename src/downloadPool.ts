// Bounded concurrency + in-flight deduplication for attachment processing.

type Task<T> = () => Promise<T>;

// Returns a wrapper that runs tasks with at most `concurrency` running at once.
export function pLimit(concurrency: number): <T>(task: Task<T>) => Promise<T> {
  if (concurrency < 1) {
    throw new Error("pLimit: concurrency must be >= 1");
  }
  let active = 0;
  const waiting: Array<() => void> = [];

  const next = () => {
    active--;
    const release = waiting.shift();
    if (release) {
      release();
    }
  };

  return function run<T>(task: Task<T>): Promise<T> {
    const start = async (): Promise<T> => {
      active++;
      try {
        return await task();
      } finally {
        next();
      }
    };

    if (active < concurrency) {
      return start();
    }
    return new Promise<T>((resolve, reject) => {
      waiting.push(() => {
        start().then(resolve, reject);
      });
    });
  };
}

// Deduplicates concurrent async work by key: while a task for a key is
// running, other callers with the same key await the same promise instead
// of re-executing. The key is released once the task settles.
export class InFlightMap<T> {
  private inflight = new Map<string, Promise<T>>();

  run(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }
    const promise = fn().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    // Avoid unhandled-rejection noise when every waiter attaches later.
    promise.catch(() => {});
    return promise;
  }
}
