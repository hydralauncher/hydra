import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CloudSaveOperationCoordinator } from "./operation-coordinator.ts";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("cloud save operation coordinator", () => {
  it("coalesces only identical operations", async () => {
    const coordinator = new CloudSaveOperationCoordinator<string>();
    const firstRun = deferred<string>();
    let identicalRuns = 0;

    const first = coordinator.run("game", "environment-a", () => {
      identicalRuns += 1;
      return firstRun.promise;
    });
    const identical = coordinator.run("game", "environment-a", () => {
      identicalRuns += 1;
      return Promise.resolve("unexpected");
    });

    assert.equal(first, identical);
    firstRun.resolve("first");
    assert.equal(await identical, "first");
    assert.equal(identicalRuns, 1);
  });

  it("serializes different environments without sharing results", async () => {
    const coordinator = new CloudSaveOperationCoordinator<string>();
    const firstRun = deferred<string>();
    const executionOrder: string[] = [];

    const first = coordinator.run("game", "environment-a", async () => {
      executionOrder.push("a:start");
      const result = await firstRun.promise;
      executionOrder.push("a:end");
      return result;
    });
    const second = coordinator.run("game", "environment-b", async () => {
      executionOrder.push("b:start");
      return "second";
    });

    await Promise.resolve();
    assert.deepEqual(executionOrder, ["a:start"]);
    firstRun.resolve("first");
    assert.equal(await first, "first");
    assert.equal(await second, "second");
    assert.deepEqual(executionOrder, ["a:start", "a:end", "b:start"]);
  });
});
