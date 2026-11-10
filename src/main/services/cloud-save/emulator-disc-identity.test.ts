import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { Game } from "../../../types/level.types";

function load() {
  const state = {
    snapshotCalls: [] as unknown[][],
    identityCalls: 0,
  };
  const modules: Record<string, unknown> = {
    "../../../shared/cloud-save-emulator-provider.js": {
      getDiscCloudSaveEmulatorProvider: (shop: string, platform?: string) =>
        shop === "launchbox" && /playstation 3/i.test(platform ?? "")
          ? "rpcs3"
          : null,
    },
    "./rpcs3-game-identity.js": {
      assertRpcs3DiscIdentity: async () => {
        state.identityCalls += 1;
        return new Set(["BLUS30443"]);
      },
      assertRpcs3SnapshotIdentity: (...args: unknown[]) => {
        state.snapshotCalls.push(args);
      },
      getRpcs3DiscIdentityStatus: async () => ({
        status: "ready",
        path: null,
        titleId: null,
      }),
    },
    "./rpcs3-title-ids.js": {
      rpcs3SavedataTitleIdsForGame: (
        _game: Game,
        catalogueIds: Iterable<string>
      ) => [...catalogueIds, "BLUS30522"].sort(),
    },
    "./rpcs3-savedata-title-ids.js": {
      getRpcs3SavedataTitleIds: async () => ["BLUS30443"],
    },
  };
  const context = {} as typeof import("./emulator-disc-identity");
  const compiled = ts.transpileModule(
    fs.readFileSync(
      new URL("./emulator-disc-identity.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  );
  vm.runInNewContext(compiled.outputText, {
    exports: context,
    require: (specifier: string) =>
      modules[specifier] ?? assert.fail(`Unexpected dependency: ${specifier}`),
  });
  return { context, state };
}

const ps3Game = {
  shop: "launchbox",
  objectId: "10001",
  platform: "Sony Playstation 3",
} as unknown as Game;
const retroArchGame = {
  shop: "launchbox",
  objectId: "131",
  platform: "Super Nintendo Entertainment System",
} as unknown as Game;
const pcGame = { shop: "steam", objectId: "620" } as unknown as Game;

test("leaves games that are not identified by disc alone", async () => {
  const { context, state } = load();
  for (const game of [retroArchGame, pcGame, null, undefined]) {
    assert.equal(await context.assertEmulatorDiscIdentity(game), null);
  }
  for (const game of [retroArchGame, pcGame]) {
    assert.equal(await context.getEmulatorDiscIdentityStatus(game), null);
    assert.equal(await context.getEmulatorSavedataTitleIds(game), undefined);
    assert.equal(context.emulatorRequiresFreshContext(game), false);
  }
  assert.equal(context.emulatorRequiresFreshContext(null), false);
  assert.equal(state.identityCalls, 0);
});

test("confirms RPCS3 discs and checks snapshots against the same IDs", async () => {
  const { context, state } = load();
  const identity = await context.assertEmulatorDiscIdentity(ps3Game);

  assert.ok(identity);
  assert.equal(state.identityCalls, 1);
  assert.deepEqual([...identity.savedataTitleIds], ["BLUS30443", "BLUS30522"]);

  const files = [
    {
      rawPath: "<emulator>/rpcs3/BLUS30443/00000001",
      relativePath: "BLUS30443-SLOT/DATA.BIN",
    },
  ];
  identity.assertSnapshotFiles(files);
  const [checkedFiles, allowedTitleIds, customPaths, allowedSavedataIds] =
    state.snapshotCalls[0];
  assert.equal(checkedFiles, files);
  assert.deepEqual([...(allowedTitleIds as Set<string>)], ["BLUS30443"]);
  assert.deepEqual([...(customPaths as unknown[])], []);
  assert.deepEqual(
    [...(allowedSavedataIds as Set<string>)],
    ["BLUS30443", "BLUS30522"]
  );

  assert.equal(context.emulatorRequiresFreshContext(ps3Game), true);
  assert.deepEqual(await context.getEmulatorSavedataTitleIds(ps3Game), [
    "BLUS30443",
  ]);
  assert.equal(
    (await context.getEmulatorDiscIdentityStatus(ps3Game))?.status,
    "ready"
  );
});
