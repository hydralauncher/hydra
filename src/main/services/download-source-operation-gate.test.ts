import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DownloadSourceOperationGate } from "./download-source-operation-gate.ts";
import { importDownloadSourceUrls } from "./download-source-backup.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe("download source operation gate", () => {
  it("waits for the entire import before removing sources so they cannot reappear", async () => {
    const gate = new DownloadSourceOperationGate();
    const firstRegistration = deferred();
    const secondRegistration = deferred();
    const secondStarted = deferred();
    const sources: string[] = [];
    const urls = ["https://example.com/first", "https://example.com/second"];
    const importing = gate.run(() =>
      importDownloadSourceUrls(urls, [], async (url) => {
        if (url === urls[0]) {
          await firstRegistration.promise;
        } else {
          secondStarted.resolve();
          await secondRegistration.promise;
        }
        sources.push(url);
      })
    );

    let removalCalled = false;
    const removing = gate.run(async () => {
      removalCalled = true;
      assert.deepEqual(sources, urls);
      sources.length = 0;
    });
    firstRegistration.resolve();
    await secondStarted.promise;
    assert.equal(removalCalled, false);
    assert.deepEqual(sources, [urls[0]]);

    secondRegistration.resolve();
    assert.equal((await importing).imported, urls.length);
    await removing;
    assert.equal(removalCalled, true);
    assert.deepEqual(sources, []);
  });

  it("queues add, remove and sync behind an in-flight poll in arrival order", async () => {
    const gate = new DownloadSourceOperationGate();
    const poll = deferred();
    const pollStarted = deferred();
    const order: string[] = [];
    let activeCallbacks = 0;
    let maxActiveCallbacks = 0;
    const run = (name: string, wait = Promise.resolve()) =>
      gate.run(async () => {
        activeCallbacks++;
        maxActiveCallbacks = Math.max(maxActiveCallbacks, activeCallbacks);
        order.push(name);
        if (name === "poll") pollStarted.resolve();
        await wait;
        activeCallbacks--;
        return name;
      });

    const polling = run("poll", poll.promise);
    await pollStarted.promise;
    const adding = run("add");
    const removing = run("remove");
    const syncing = run("sync");
    assert.deepEqual(order, ["poll"]);

    poll.resolve();
    assert.deepEqual(await Promise.all([polling, adding, removing, syncing]), [
      "poll",
      "add",
      "remove",
      "sync",
    ]);
    assert.deepEqual(order, ["poll", "add", "remove", "sync"]);
    assert.equal(maxActiveCallbacks, 1);
  });

  it("continues queued operations after a rejection or a synchronous throw", async () => {
    const gate = new DownloadSourceOperationGate();
    const operation = deferred();
    const failing = gate.run(async () => {
      await operation.promise;
      throw new Error("Sync failed");
    });
    const rejected = assert.rejects(failing, /Sync failed/);
    const throwing = gate.run(() => {
      throw new Error("Invalid backup");
    });
    const thrown = assert.rejects(throwing, /Invalid backup/);
    const queued = gate.run(async () => "next operation");

    operation.resolve();
    await Promise.all([rejected, thrown]);
    assert.equal(await queued, "next operation");
  });

  it("continues after a cancelled file dialog", async () => {
    const gate = new DownloadSourceOperationGate();
    const cancelled = gate.run(async () => null);
    const queued = gate.run(async () => "next operation");

    assert.equal(await cancelled, null);
    assert.equal(await queued, "next operation");
  });
});
