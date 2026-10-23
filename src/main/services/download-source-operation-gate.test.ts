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
  it("blocks removal during an unfinished batch so sources cannot reappear", async () => {
    const gate = new DownloadSourceOperationGate();
    const registration = deferred();
    const sources: string[] = [];
    const urls = ["https://example.com/first", "https://example.com/second"];
    const importing = gate.run(() =>
      importDownloadSourceUrls(urls, [], async (url) => {
        await registration.promise;
        sources.push(url);
      })
    );

    let removalCalled = false;
    await assert.rejects(
      gate.run(async () => {
        removalCalled = true;
        sources.length = 0;
      }),
      /download_source_operation_in_progress/
    );
    assert.equal(removalCalled, false);
    registration.resolve();
    assert.equal((await importing).imported, urls.length);
    assert.deepEqual(sources, urls);

    await gate.run(async () => {
      sources.length = 0;
    });
    assert.deepEqual(sources, []);
  });

  it("rejects overlapping mutations before their callbacks execute", async () => {
    const gate = new DownloadSourceOperationGate();
    const operation = deferred();
    const active = gate.run(() => operation.promise);
    let overlappingCalls = 0;
    const conflictingOperations = ["import", "add", "remove", "sync"];
    await Promise.all(
      conflictingOperations.map(() =>
        assert.rejects(
          gate.run(async () => {
            overlappingCalls++;
          }),
          /download_source_operation_in_progress/
        )
      )
    );
    assert.equal(overlappingCalls, 0);
    operation.resolve();
    await active;
  });

  it("releases the reservation after cancellation and failure", async () => {
    const gate = new DownloadSourceOperationGate();
    assert.equal(await gate.run(async () => null), null);
    await assert.rejects(
      gate.run(async () => {
        throw new Error("Invalid backup");
      }),
      /Invalid backup/
    );
    assert.equal(
      await gate.run(async () => "next operation"),
      "next operation"
    );
  });
});
