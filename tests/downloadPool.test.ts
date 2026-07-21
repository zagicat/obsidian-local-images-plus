import { describe, test, expect } from "vitest";
import { pLimit, InFlightMap } from "../src/downloadPool";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("pLimit", () => {
  test("runs at most N tasks concurrently", async () => {
    const limit = pLimit(2);
    let running = 0;
    let peak = 0;
    const gates = [deferred<void>(), deferred<void>(), deferred<void>(), deferred<void>()];

    const tasks = gates.map((gate) =>
      limit(async () => {
        running++;
        peak = Math.max(peak, running);
        await gate.promise;
        running--;
      })
    );

    // Let the first wave start
    await new Promise((r) => setTimeout(r, 10));
    expect(peak).toBe(2);

    gates.forEach((g) => g.resolve());
    await Promise.all(tasks);
    expect(peak).toBe(2);
  });

  test("returns task results in order of invocation", async () => {
    const limit = pLimit(2);
    const results = await Promise.all([
      limit(async () => "a"),
      limit(async () => "b"),
      limit(async () => "c"),
    ]);
    expect(results).toEqual(["a", "b", "c"]);
  });

  test("a rejected task does not block the queue", async () => {
    const limit = pLimit(1);
    const first = limit(async () => {
      throw new Error("boom");
    });
    const second = limit(async () => "ok");

    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
  });
});

describe("InFlightMap", () => {
  test("concurrent calls with the same key share one execution", async () => {
    const map = new InFlightMap<string>();
    let calls = 0;
    const gate = deferred<string>();

    const run = () =>
      map.run("keyA", async () => {
        calls++;
        return gate.promise;
      });

    const p1 = run();
    const p2 = run();
    gate.resolve("value");

    expect(await p1).toBe("value");
    expect(await p2).toBe("value");
    expect(calls).toBe(1);
  });

  test("different keys execute independently", async () => {
    const map = new InFlightMap<string>();
    let calls = 0;
    const fn = async () => {
      calls++;
      return "v" + calls;
    };
    const [a, b] = await Promise.all([map.run("k1", fn), map.run("k2", fn)]);
    expect(calls).toBe(2);
    expect(a).not.toBe(b);
  });

  test("key is released after completion so later calls re-execute", async () => {
    const map = new InFlightMap<number>();
    let calls = 0;
    const fn = async () => ++calls;
    await map.run("k", fn);
    await map.run("k", fn);
    expect(calls).toBe(2);
  });

  test("a rejection propagates to all waiters and releases the key", async () => {
    const map = new InFlightMap<string>();
    const gate = deferred<string>();
    const p1 = map.run("k", () => gate.promise);
    const p2 = map.run("k", () => gate.promise);
    gate.reject(new Error("dl failed"));

    await expect(p1).rejects.toThrow("dl failed");
    await expect(p2).rejects.toThrow("dl failed");

    // key released — next run executes fresh
    const ok = await map.run("k", async () => "recovered");
    expect(ok).toBe("recovered");
  });
});
