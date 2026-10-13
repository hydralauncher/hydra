import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { EpicIntegrationError, isRecord } from "./auth-protocol.ts";
import { EpicIntegrationCore } from "./integration-core.ts";
import { EpicConnectionStore } from "./store.ts";
import { deferred, MemoryDatabase } from "./store-test-helpers.ts";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "epic-lifecycle-"));
  const stores: EpicConnectionStore[] = [];
  const state = {
    cleanup: async () => {},
    open: async () => {},
    cleanupCalls: 0,
    subscriptions: 0,
    unsubscriptions: 0,
  };
  const modules: Record<string, unknown> = {
    electron: { app: { getPath: () => root } },
    "node:fs": fs,
    "../hydra-api": {
      HydraApi: {
        getAuthContext: () => null,
        isAuthContextCurrent: () => false,
        onAuthContextChanged: () => {
          state.subscriptions++;
          return () => {
            state.unsubscriptions++;
          };
        },
      },
    },
    "../legendary": { Legendary: { getBinaryPath: () => null } },
    "../window-manager": { WindowManager: { mainWindow: null } },
    "./auth-window": {
      openEpicAuthWindow: () => assert.fail("unexpected window"),
    },
    "./auth-protocol": { EpicIntegrationError, isRecord },
    "./integration-core": { EpicIntegrationCore },
    "./legendary-auth": {
      cleanupEpicTemporarySessions: async () => {
        state.cleanupCalls++;
        await state.cleanup();
      },
      LegendaryAuthRunner: {
        create: () => assert.fail("unexpected Legendary invocation"),
      },
    },
    "./store": {
      EpicConnectionStore: class extends EpicConnectionStore {
        constructor(
          options: ConstructorParameters<typeof EpicConnectionStore>[0]
        ) {
          super({
            ...options,
            createDatabase: () => {
              const db = new MemoryDatabase();
              db.onOpen = () => state.open();
              return db;
            },
          });
          stores.push(this);
        }
      },
    },
  };
  const integration = {} as typeof import("./index");
  const source = fs.readFileSync(
    new URL("./index.ts", import.meta.url),
    "utf8"
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  vm.runInNewContext(compiled.outputText, {
    exports: integration,
    require: (specifier: string) =>
      modules[specifier] ?? assert.fail(`Unexpected dependency: ${specifier}`),
    process,
  });
  t.after(async () => {
    await integration.shutdownEpicIntegration();
    await Promise.all(stores.map((store) => store.close()));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { state, stores, integration };
}

test("shutdown during startup cleanup prevents late database creation and subscription", async (t) => {
  const f = fixture(t),
    started = deferred<void>(),
    release = deferred<void>();
  f.state.cleanup = async () => {
    started.resolve();
    await release.promise;
  };
  const initializing = f.integration.initializeEpicIntegration();
  await started.promise;
  await f.integration.shutdownEpicIntegration();
  release.resolve();
  await initializing;
  await f.integration.initializeEpicIntegration();
  assert.equal(f.stores.length, 0);
  assert.equal(f.state.subscriptions, 0);
  assert.equal(f.state.cleanupCalls, 1);
  assert.throws(() => f.integration.getEpicConnection(), {
    code: "operation-cancelled",
  });
});

test("initial open failure is sanitized, retryable and shutdown unsubscribes", async (t) => {
  const f = fixture(t);
  let opens = 0;
  f.state.open = async () => {
    if (++opens === 1) throw new Error("secret-refresh");
  };
  await assert.rejects(f.integration.initializeEpicIntegration(), {
    code: "persistence-failed",
    message: "persistence-failed",
  });
  await f.integration.initializeEpicIntegration();
  assert.equal(opens, 2);
  assert.equal(f.stores.length, 1);
  assert.equal(f.state.subscriptions, 1);
  await f.integration.shutdownEpicIntegration();
  assert.equal(f.state.unsubscriptions, 1);
  await assert.rejects(f.stores[0].open(), { code: "persistence-failed" });
});
