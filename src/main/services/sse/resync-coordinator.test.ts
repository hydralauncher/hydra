import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResyncCoordinator } from "./resync-coordinator.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("ResyncCoordinator", () => {
  it("coalesces bursts and serializes work", async () => {
    const runs: string[][] = [];
    const resolvers: Array<() => void> = [];
    const coordinator = new ResyncCoordinator<"friends" | "notifications">(
      (scopes) =>
        new Promise<void>((resolve) => {
          runs.push([...scopes]);
          resolvers.push(resolve);
        })
    );
    const signal = new AbortController().signal;

    const first = coordinator.request(["friends"], signal);
    const second = coordinator.request(["notifications"], signal);
    await tick();
    assert.deepEqual(runs, [["friends", "notifications"]]);

    const third = coordinator.request(["friends"], signal);
    await tick();
    assert.equal(runs.length, 1);
    resolvers[0]();
    await tick();
    assert.deepEqual(runs, [["friends", "notifications"], ["friends"]]);
    resolvers[1]();
    await Promise.all([first, second, third]);
  });

  it("aborts shared work only after every requester aborts", async () => {
    let runSignal: AbortSignal | undefined;
    const coordinator = new ResyncCoordinator<"friends">(
      async (_scopes, signal) => {
        runSignal = signal;
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
    );
    const first = new AbortController();
    const second = new AbortController();

    const requests = [
      coordinator.request(["friends"], first.signal),
      coordinator.request(["friends"], second.signal),
    ];
    await tick();
    first.abort();
    assert.equal(runSignal?.aborted, false);
    second.abort();
    assert.equal(runSignal?.aborted, true);
    await Promise.all(requests);
  });
});
