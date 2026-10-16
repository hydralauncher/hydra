import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import type { Game } from "@types";

test("startup reconciliation preserves busy or uninspectable prefixes and removes only exact stopped game tokens", async () => {
  const removed: string[] = [];
  const checked: string[] = [];
  const receiptReads = new Map<string, number>();
  const modules: Record<string, unknown> = {
    "../system-path": { SystemPath: { getPath: () => "/userdata" } },
    "./legendary-managed-runtime": {
      managedWorkspacePath: (
        _data: string,
        _owner: unknown,
        artifact: string
      ) => `/workspace/${artifact}`,
    },
    "./linux-runtime": {
      getEpicLinuxLastPreparedPrefix: async (game: Game) => {
        const artifact = game.epicInstallation!.artifactId;
        const reads = (receiptReads.get(artifact) ?? 0) + 1;
        receiptReads.set(artifact, reads);
        if (artifact === "MissingReceipt") return null;
        if (
          artifact === "Changed" ||
          (artifact === "ChangedDuringLock" && reads > 1)
        )
          return `/previous-prefix/${artifact}`;
        return `/prefix/${artifact}`;
      },
      resolveEpicLinuxPrefixPath: async (
        _game: unknown,
        _owner: unknown,
        artifact: string
      ) => `/prefix/${artifact}`,
      withEpicLinuxPrefixMutation: async (
        prefix: string,
        task: () => Promise<unknown>
      ) => {
        checked.push(prefix);
        if (prefix.endsWith("Busy") || prefix.endsWith("Unknown"))
          throw new Error("compatibility-prefix-busy");
        return task();
      },
    },
    "./ownership-token.js": {
      disposeEpicOwnershipTokenIfStopped: async (
        workspace: string,
        objectId: string
      ) => {
        removed.push(`${workspace}:${objectId}`);
        return true;
      },
    },
  };
  const compiled = ts.transpileModule(
    await fs.readFile(
      new URL("./ownership-token-reconciliation.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText;
  const exported = {} as typeof import("./ownership-token-reconciliation");
  vm.runInNewContext(compiled, {
    exports: exported,
    process: { platform: "linux" },
    require: (name: string) => {
      assert.ok(name in modules, name);
      return modules[name];
    },
  });
  const games = [
    "Stopped",
    "Busy",
    "Unknown",
    "Changed",
    "MissingReceipt",
    "ChangedDuringLock",
  ].map((artifactId) => ({
    shop: "epic",
    objectId: `Namespace:${artifactId}`,
    epicInstallation: { owner: {}, artifactId, platform: "Windows" },
  }));
  const result = await exported.reconcileEpicLinuxOwnershipTokens(
    games as never
  );
  assert.equal(result.removed, 1);
  assert.equal(result.preserved, 5);
  assert.deepEqual(removed, ["/workspace/Stopped:Namespace:Stopped"]);
  assert.deepEqual(checked, [
    "/prefix/Stopped",
    "/prefix/Busy",
    "/prefix/Unknown",
    "/prefix/ChangedDuringLock",
  ]);
});
