import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { test } from "node:test";
import * as queue from "../library-sync/library-write-queue.js";
import type { Game } from "@types";

const context = { environment: "staging", userId: "A", generation: 1 };
const game = (source: Game["source"], connectionId = "connection-A"): Game => ({
  title: "Game",
  shop: "epic",
  objectId: "Namespace:Item",
  iconUrl: null,
  logoImageUrl: null,
  libraryHeroImageUrl: null,
  remoteId: "Remote",
  isDeleted: false,
  source,
  lastTimePlayed: null,
  playTimeInMilliseconds: 100,
  steamPlayTimeInMilliseconds: 200,
  epicPlayTimeInMilliseconds: 300,
  hasActiveEpicImport: true,
  favorite: true,
  isPinned: true,
  executablePath: "C:\\Games\\game.exe",
  customCoverImageUrl: "https://art.test/cover",
  epicImportScope: { ...context, connectionId },
});
function fixture() {
  const games = new Map<string, Game>();
  const state = { current: true, read: async () => {} };
  const modules = {
    "../library-sync/library-write-queue": queue,
    "@main/level": {
      gamesSublevel: {
        iterator: () => ({
          all: async () => {
            await state.read();
            return [...games];
          },
        }),
        batch: async (operations: { key: string; value: Game }[]) => {
          for (const op of operations) games.set(op.key, op.value);
        },
      },
    },
  };
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(new URL("./import-cleanup.ts", import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }
    ).outputText,
    {
      exports,
      require: (name: keyof typeof modules) =>
        modules[name] ?? assert.fail(name),
    }
  );
  return { games, state, ...(exports as typeof import("./import-cleanup")) };
}

test("unlinking Epic removes only its contribution and hides only exclusive imports", async () => {
  const f = fixture();
  const hydra = game("hydra");
  f.games.set("hydra", hydra);
  f.games.set("exclusive", game("epic"));
  f.games.set("other-connection", game("epic", "connection-B"));
  await f.clearEpicImports(context, "connection-A");
  const remaining = f.games.get("hydra")!;
  assert.equal(remaining.isDeleted, false);
  assert.equal(f.games.get("exclusive")?.isDeleted, true);
  assert.equal(
    f.games.get("other-connection")?.epicPlayTimeInMilliseconds,
    300
  );
  assert.equal(remaining.epicPlayTimeInMilliseconds, 0);
  assert.equal(remaining.hasActiveEpicImport, false);
  assert.equal(remaining.epicImportScope, undefined);
  assert.equal(remaining.remoteId, hydra.remoteId);
  for (const field of [
    "playTimeInMilliseconds",
    "steamPlayTimeInMilliseconds",
    "favorite",
    "isPinned",
    "executablePath",
    "customCoverImageUrl",
  ] as const)
    assert.equal(remaining[field], hydra[field]);
});

test("account/environment changes clear stale Epic data before uploading, including A to B to A", async () => {
  const f = fixture();
  f.games.set("game", game("epic"));
  await f.clearStaleEpicImports({ ...context, userId: "B", generation: 2 });
  assert.equal(f.games.get("game")?.isDeleted, true);
  assert.equal(f.games.get("game")?.remoteId, null);
  assert.equal(f.games.get("game")?.epicPlayTimeInMilliseconds, 0);
  f.games.set("game", {
    ...game("hydra"),
    epicImportScope: { ...context, userId: "B", connectionId: "connection-B" },
  });
  await f.clearStaleEpicImports({ ...context, generation: 3 });
  assert.equal(f.games.get("game")?.isDeleted, false);
  assert.equal(f.games.get("game")?.epicPlayTimeInMilliseconds, 0);
  assert.equal(f.games.get("game")?.playTimeInMilliseconds, 100);
  f.games.set("game", game("epic"));
  await f.clearStaleEpicImports({ ...context, environment: "production" });
  assert.equal(f.games.get("game")?.epicPlayTimeInMilliseconds, 0);
});

test("cleanup invalidated during its read cannot clear a new account's imports", async () => {
  const f = fixture();
  f.games.set("game", game("epic"));
  f.state.read = async () => {
    f.state.current = false;
  };
  await f.clearStaleEpicImports(null, () => f.state.current);
  assert.equal(f.games.get("game")?.epicPlayTimeInMilliseconds, 300);
  assert.equal(f.games.get("game")?.isDeleted, false);
});

test("confirmed remote unlink or replacement cleans imports even when the connection store is missing", async () => {
  for (const nextConnection of [null, "connection-new"]) {
    const f = fixture();
    f.games.set("hydra", game("hydra"));
    f.games.set("exclusive", game("epic"));
    const count = await f.clearStaleEpicImports(
      context,
      () => true,
      nextConnection
    );
    assert.equal(count, 2);
    assert.equal(f.games.get("exclusive")?.isDeleted, true);
    assert.equal(f.games.get("hydra")?.isDeleted, false);
    assert.equal(f.games.get("hydra")?.remoteId, "Remote");
    assert.equal(f.games.get("hydra")?.playTimeInMilliseconds, 100);
    assert.equal(f.games.get("hydra")?.steamPlayTimeInMilliseconds, 200);
    assert.equal(f.games.get("hydra")?.epicPlayTimeInMilliseconds, 0);
  }
});
