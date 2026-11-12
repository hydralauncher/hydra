import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  baseRefForBranch,
  findMissingUsages,
  readBridgeMembers,
} from "./check-ota-bridge.mjs";

const members = readBridgeMembers(
  "preload.ts",
  `
    contextBridge.exposeInMainWorld("electron", {
      getVersion: () => ipcRenderer.invoke("getVersion"),
      leveldb: { get: () => ipcRenderer.invoke("leveldbGet") },
    });
  `
);

// The missing members `source` uses, as "member" when unguarded and
// "member (guarded)" when allowed.
const check = (source) =>
  findMissingUsages("file.ts", source, members).map(({ missing, guarded }) =>
    guarded ? `${missing} (guarded)` : missing
  );

describe("baseRefForBranch", () => {
  test("maps both release branch formats to the shipped tag", () => {
    assert.equal(baseRefForBranch("release/4.1.5"), "v4.1.5");
    assert.equal(baseRefForBranch("release/v4.1.5"), "v4.1.5");
    assert.equal(baseRefForBranch("release/4.2.0-beta.1"), "v4.2.0-beta.1");
  });

  test("rejects branches without a version", () => {
    assert.throws(() => baseRefForBranch("release/next"));
    assert.throws(() => baseRefForBranch("main"));
  });
});

describe("findMissingUsages", () => {
  test("allows members the shipped preload has", () => {
    assert.deepEqual(
      check(`
        window.electron.getVersion();
        globalThis.window.electron.leveldb.get();
        window.electron.getVersion.bind(null);
      `),
      []
    );
  });

  test("reports unguarded calls to missing members", () => {
    assert.deepEqual(check(`window.electron.newFn();`), ["newFn"]);
  });

  test("allows optional calls and typeof checks", () => {
    assert.deepEqual(
      check(`
        window.electron.newFn?.();
        const isAvailable = typeof window.electron.newFn === "function";
      `),
      ["newFn (guarded)", "newFn (guarded)"]
    );
  });

  test("guards calls inside if, ?: and &&", () => {
    assert.deepEqual(
      check(`
        if (typeof window.electron.newFn === "function") {
          window.electron.newFn();
        }
        const result =
          typeof window.electron.newFn === "function"
            ? window.electron.newFn()
            : null;
        window.electron.newFn && window.electron.newFn();
      `).filter((usage) => !usage.endsWith("(guarded)")),
      []
    );
  });

  test("guards calls after an early return", () => {
    assert.deepEqual(
      check(`
        function run(enabled: boolean) {
          if (!enabled || typeof window.electron.newFn !== "function") return;
          window.electron.newFn();
        }
      `).filter((usage) => !usage.endsWith("(guarded)")),
      []
    );
  });

  test("keeps guards local to the code they protect", () => {
    assert.deepEqual(
      check(`
        window.electron.newFn?.();
        window.electron.newFn();
      `),
      ["newFn (guarded)", "newFn"]
    );

    assert.deepEqual(
      check(`
        function guarded() {
          if (typeof window.electron.newFn === "function") {
            window.electron.newFn();
          }
        }
        function unguarded() {
          window.electron.newFn();
        }
      `),
      ["newFn (guarded)", "newFn (guarded)", "newFn"]
    );
  });

  test("ignores checks that don't stop the call", () => {
    assert.deepEqual(
      check(`
        if (typeof window.electron.newFn !== "function") {
          console.warn("newFn is missing");
        }
        window.electron.newFn();
        if (typeof window.electron.getVersion === "function") {
          window.electron.newFn();
        }
      `).filter((usage) => !usage.endsWith("(guarded)")),
      ["newFn", "newFn"]
    );
  });

  test("reports reads through a missing namespace", () => {
    assert.deepEqual(
      check(`
        window.electron.newApi.newFn?.();
        const isAvailable = typeof window.electron.newApi.newFn === "function";
      `),
      ["newApi", "newApi"]
    );
  });

  test("allows optional access on a missing namespace", () => {
    assert.deepEqual(
      check(`
        window.electron.newApi?.newFn();
        window.electron.leveldb.newFn?.();
      `),
      ["newApi (guarded)", "leveldb.newFn (guarded)"]
    );
  });

  test("reports missing members in existing namespaces", () => {
    assert.deepEqual(check(`window.electron.leveldb.newFn();`), [
      "leveldb.newFn",
    ]);
  });

  test("checks bracket access with string literals", () => {
    assert.deepEqual(
      check(`
        window.electron["newFn"]();
        window.electron.leveldb["newFn"]();
        window.electron["getVersion"]();
      `),
      ["newFn", "leveldb.newFn"]
    );
  });

  test("follows aliases of the bridge", () => {
    assert.deepEqual(
      check(`
        const electron = globalThis.window.electron as Bridge;
        electron.newFn();
        if (!electron || typeof electron.otherFn !== "function") return;
        electron.otherFn();
      `).filter((usage) => !usage.endsWith("(guarded)")),
      ["newFn"]
    );
  });

  test("recognizes guards on destructured members", () => {
    assert.deepEqual(
      check(`
        const sync = (count: number) => {
          const { newFn } = globalThis.window.electron;
          if (typeof newFn !== "function") return;

          newFn(count).catch(() => {});
        };
      `),
      ["newFn (guarded)"]
    );
  });

  test("reports unguarded calls to destructured members", () => {
    assert.deepEqual(
      check(`
        const { newFn, getVersion, renamed: alias } = window.electron;
        getVersion();
        newFn();
        alias?.();
      `),
      ["newFn", "renamed (guarded)"]
    );
  });

  test("reports destructuring a missing namespace", () => {
    assert.deepEqual(
      check(`
        const { newApi: { newFn } } = window.electron;
        const { leveldb: { get } } = window.electron;
        get();
      `),
      ["newApi"]
    );
  });

  test("reports calls through a defaulted missing namespace", () => {
    assert.deepEqual(
      check(`
        const { newApi: { newFn } = {} } = window.electron;
        newFn();
        newFn?.();
      `),
      ["newApi", "newApi (guarded)"]
    );

    assert.deepEqual(
      check(`
        const { get } = window.electron.newApi ?? {};
        get();
      `),
      ["newApi (guarded)", "newApi"]
    );
  });

  test("keeps aliases and destructured members to their own scope", () => {
    assert.deepEqual(
      check(`
        function bridge() {
          const electron = window.electron;
          electron.newFn();
        }
        function client(electron: { other(): void }) {
          electron.other();
        }
        function local() {
          const electron = createClient();
          electron.other();
        }
      `),
      ["newFn"]
    );

    assert.deepEqual(
      check(`
        const { newFn } = window.electron;
        function run(newFn: () => void) {
          newFn();
        }
      `),
      []
    );
  });
});
