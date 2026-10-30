import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { describe, it } from "node:test";
import ts from "typescript";
import type { DownloadSourceImportResult } from "@types";
import * as backups from "../../services/download-source-backup.js";
import { DownloadSourceOperationGate } from "../../services/download-source-operation-gate.js";

const firstUrl = "https://example.com/first.json";
const secondUrl = "https://example.com/second.json";
const selectedFile = { canceled: false, filePaths: ["backup.json"] };
const cancelledDialog = { canceled: true, filePaths: [] };

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

const handlerCode = ts.transpileModule(
  fs.readFileSync(
    new URL("./import-download-sources.ts", import.meta.url),
    "utf8"
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }
).outputText;

const fixture = (
  options: {
    dialog?: Promise<typeof selectedFile>;
    read?: Promise<void>;
    contents?: string;
    beforeAdd?: (url: string) => Promise<void>;
  } = {}
) => {
  const contents =
    options.contents ??
    backups.serializeDownloadSources([{ url: firstUrl }, { url: secondUrl }]);
  const gate = new DownloadSourceOperationGate();
  const dialogOpened = deferred<void>();
  const readStarted = deferred<void>();
  const importQueued = deferred<void>();
  const state = {
    sources: [] as { url: string }[],
    additions: [] as string[],
    snapshotReads: 0,
    gateCalls: 0,
    fileClosed: false,
  };
  let handler!: (event: {
    sender: object;
  }) => Promise<DownloadSourceImportResult | null>;
  const dependencies: Record<string, unknown> = {
    electron: {
      BrowserWindow: { fromWebContents: () => ({}) },
      dialog: {
        showOpenDialog: () => {
          dialogOpened.resolve();
          return options.dialog ?? Promise.resolve(selectedFile);
        },
      },
    },
    "node:fs/promises": {
      open: async () => ({
        stat: async () => ({ size: Buffer.byteLength(contents) }),
        read: async (buffer: Buffer) => {
          readStarted.resolve();
          await options.read;
          const bytesRead = Buffer.from(contents).copy(buffer);
          return { bytesRead };
        },
        close: async () => {
          state.fileClosed = true;
        },
      }),
    },
    "@main/level": {
      downloadSourcesSublevel: {
        values: () => ({
          all: async () => {
            state.snapshotReads++;
            return [...state.sources];
          },
        }),
      },
    },
    "@main/services/download-source-backup": backups,
    "@main/services/add-download-source": {
      addDownloadSource: async (url: string) => {
        await options.beforeAdd?.(url);
        state.additions.push(url);
        state.sources.push({ url });
      },
    },
    "@main/services/download-source-operation-gate": {
      downloadSourceOperationGate: {
        run: <T>(operation: () => Promise<T>) => {
          state.gateCalls++;
          importQueued.resolve();
          return gate.run(operation);
        },
      },
    },
    "../register-event": {
      registerEvent: (name: string, listener: typeof handler) => {
        assert.equal(name, "importDownloadSources");
        handler = listener;
      },
    },
  };
  vm.runInNewContext(handlerCode, {
    exports: {},
    Buffer,
    require: (name: string) =>
      dependencies[name] ?? assert.fail(`Unexpected dependency: ${name}`),
  });
  return {
    gate,
    state,
    dialogOpened: dialogOpened.promise,
    readStarted: readStarted.promise,
    importQueued: importQueued.promise,
    invoke: () => handler({ sender: {} }),
  };
};

describe("download source import handler", () => {
  it("allows add, remove and sync while the file dialog remains open", async () => {
    const dialog = deferred<typeof selectedFile>();
    const f = fixture({ dialog: dialog.promise });
    const importing = f.invoke();
    await f.dialogOpened;
    const completed: string[] = [];
    const operations = ["add", "remove", "sync"].map((name) =>
      f.gate.run(async () => {
        completed.push(name);
      })
    );
    try {
      await nextTurn();
      assert.deepEqual(completed, ["add", "remove", "sync"]);
      assert.equal(f.state.gateCalls, 0);
      assert.equal(f.state.snapshotReads, 0);
    } finally {
      dialog.resolve(cancelledDialog);
      assert.equal(await importing, null);
      await Promise.all(operations);
    }
  });

  it("keeps file reading outside the gate", async () => {
    const read = deferred<void>();
    const f = fixture({ read: read.promise });
    const importing = f.invoke();
    await f.readStarted;
    let synced = false;
    const syncing = f.gate.run(async () => {
      synced = true;
    });
    try {
      await nextTurn();
      assert.equal(synced, true);
      assert.equal(f.state.gateCalls, 0);
      assert.equal(f.state.fileClosed, false);
    } finally {
      read.resolve();
      await syncing;
      await importing;
    }
    assert.equal(f.state.fileClosed, true);
  });

  it("reads existing sources after earlier queued mutations finish", async () => {
    const mutation = deferred<void>();
    const mutationStarted = deferred<void>();
    const f = fixture();
    const adding = f.gate.run(async () => {
      mutationStarted.resolve();
      await mutation.promise;
      f.state.sources.push({ url: firstUrl });
    });
    await mutationStarted.promise;
    const importing = f.invoke();
    await f.importQueued;
    try {
      assert.equal(f.state.snapshotReads, 0);
      assert.equal(f.state.fileClosed, true);
    } finally {
      mutation.resolve();
      await adding;
    }
    assert.deepEqual(await importing, { imported: 1, skipped: 1, failed: [] });
    assert.deepEqual(f.state.additions, [secondUrl]);
    assert.equal(f.state.snapshotReads, 1);
  });

  it("keeps the full batch inside the gate before a queued removal", async () => {
    const firstRegistration = deferred<void>();
    const secondRegistration = deferred<void>();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const f = fixture({
      beforeAdd: async (url) => {
        if (url === firstUrl) {
          firstStarted.resolve();
          await firstRegistration.promise;
        } else {
          secondStarted.resolve();
          await secondRegistration.promise;
        }
      },
    });
    const importing = f.invoke();
    await firstStarted.promise;
    let removed = false;
    const removing = f.gate.run(async () => {
      assert.deepEqual(f.state.additions, [firstUrl, secondUrl]);
      f.state.sources.length = 0;
      removed = true;
    });
    firstRegistration.resolve();
    await secondStarted.promise;
    try {
      assert.equal(removed, false);
      assert.deepEqual(f.state.additions, [firstUrl]);
    } finally {
      secondRegistration.resolve();
      await removing;
    }
    assert.deepEqual(await importing, { imported: 2, skipped: 0, failed: [] });
    assert.deepEqual(f.state.sources, []);
  });

  it("rejects malformed files before entering a busy gate", async () => {
    const mutation = deferred<void>();
    const f = fixture({ contents: "not JSON" });
    const mutating = f.gate.run(() => mutation.promise);
    let rejected = false;
    const importing = assert
      .rejects(f.invoke(), /Invalid download source backup/)
      .then(() => {
        rejected = true;
      });
    try {
      await nextTurn();
      assert.equal(rejected, true);
      assert.equal(f.state.gateCalls, 0);
      assert.equal(f.state.snapshotReads, 0);
      assert.deepEqual(f.state.additions, []);
    } finally {
      mutation.resolve();
      await mutating;
      await importing;
    }
    assert.equal(f.state.fileClosed, true);
  });
});
