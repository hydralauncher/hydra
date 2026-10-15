import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { Game } from "../../../types/level.types";

const DEFAULT_PREFIX = "/prefixes/Namespace:Item";
const MANAGED_PREFIX = "/prefixes/epic/owner-artifact";

function load(game: Game | undefined) {
  const state = {
    managedRequests: [] as unknown[][],
    environmentPrefixes: [] as Array<string | undefined>,
  };
  const modules: Record<string, unknown> = {
    "@main/level": {
      gamesSublevel: { get: async () => game },
      levelKeys: {
        game: (shop: string, objectId: string) => `${shop}:${objectId}`,
      },
    },
    "@main/services/steam": { getSteamLocation: async () => undefined },
    "@main/services/system-path": { SystemPath: { getPath: () => "/home" } },
    "@main/services/wine": {
      Wine: {
        getEffectivePrefixPath: () => DEFAULT_PREFIX,
        resolvePrefixPath: async (prefix: string | null) => prefix,
        validatePrefix: () => true,
      },
    },
    "@main/services/logger": { logger: { warn: () => {} } },
    "@main/services/steam-login-users": {
      getSteamStoreUserContext: async () => ({ known: [] }),
    },
    "@shared": { getCloudSaveEmulatorProvider: () => null },
    "../emulators/emulators-repository": {
      getEmulatorConfig: async () => null,
    },
    "../retroarch/retroarch-repository": {
      getRetroArchConfig: async () => null,
    },
    "./emulator-save-provider": {
      getEmulatorSaveEnvironmentKey: async () => "",
    },
    "./emulator-provider-identity": {
      emulatorEnvironmentId: (id: string) => id,
    },
    "./cloud-save-environment": {
      resolveCloudSaveEnvironment: async (context: {
        winePrefixPath?: string;
      }) => {
        state.environmentPrefixes.push(context.winePrefixPath);
        return { environmentId: "env", prefixIdentityMode: "marker" };
      },
    },
    "../epic/linux-runtime": {
      resolveEpicLinuxPrefixPath: async (...args: unknown[]) => {
        state.managedRequests.push(args);
        return MANAGED_PREFIX;
      },
    },
  };
  const context = {} as typeof import("./cloud-save-game-context");
  const compiled = ts.transpileModule(
    fs.readFileSync(
      new URL("./cloud-save-game-context.ts", import.meta.url),
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
    process: { ...process, platform: "linux" },
  });
  return { context, state };
}

const owner = {
  environment: "https://api.test",
  userId: "user",
  epicAccountId: "a".repeat(32),
};

const managedGame = {
  shop: "epic",
  objectId: "Namespace:Item",
  executablePath: "/games/EpicGame/Game.exe",
  epicInstallation: { owner, artifactId: "Artifact", platform: "Windows" },
} as unknown as Game;

test("managed Epic games resolve the owner/artifact prefix the launch uses", async () => {
  const { context, state } = load(managedGame);
  await context.getCloudSaveGameContext("Namespace:Item", "epic");
  assert.equal(state.managedRequests.length, 1);
  assert.equal(state.managedRequests[0][0], managedGame);
  assert.equal(state.managedRequests[0][1], owner);
  assert.equal(state.managedRequests[0][2], "Artifact");
  assert.deepEqual(state.environmentPrefixes, [MANAGED_PREFIX]);
});

test("explicit prefix overrides still win for managed Epic games", async () => {
  const { context, state } = load(managedGame);
  await context.getCloudSaveGameContext("Namespace:Item", "epic", {
    winePrefixPath: "/captured/prefix",
  });
  assert.equal(state.managedRequests.length, 0);
  assert.deepEqual(state.environmentPrefixes, ["/captured/prefix"]);
});

test("unmanaged Windows games keep the default per-game prefix", async () => {
  const { context, state } = load({
    ...managedGame,
    shop: "steam",
    epicInstallation: undefined,
  } as Game);
  await context.getCloudSaveGameContext("Namespace:Item", "steam");
  assert.equal(state.managedRequests.length, 0);
  assert.deepEqual(state.environmentPrefixes, [DEFAULT_PREFIX]);
});
