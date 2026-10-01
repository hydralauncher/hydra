import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import type { IpcMainInvokeEvent } from "electron";
import ts from "typescript";
import YAML from "yaml";

import type { Game, GameShop } from "@types";
import { assertLegacyCloudSaveWriteAllowed } from "../../services/cloud-save/legacy-cloud-save-policy.js";

const handlerSource = fs.readFileSync(
  new URL("./download-game-artifact.ts", import.meta.url),
  "utf8"
);
const handlerCode = ts.transpileModule(handlerSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
}).outputText;

const runDownload = async (
  game: Pick<Game, "shop" | "platform"> | null,
  requestFails = false
) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-artifact-"));
  const objectId = "legacy-game";
  const shop = game?.shop ?? "steam";
  const destination = path.join(root, "restored", "save.bin");
  const requests: string[] = [];
  const urls: string[] = [];
  let listener!: (
    event: IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    artifactId: string
  ) => Promise<void>;
  let complete!: (success: boolean) => void;
  const completion = new Promise<boolean>((resolve) => {
    complete = resolve;
  });

  const dependencies: Record<string, unknown> = {
    "@main/services": {
      CloudSync: { getWindowsLikeUserProfilePath: () => "/current-profile" },
      Wine: { getEffectivePrefixPath: () => null },
      logger: { info: () => {}, error: () => {} },
      WindowManager: {
        sendToAppWindows: (channel: string, result: boolean) => {
          assert.equal(
            channel,
            `on-backup-download-complete-${objectId}-${shop}`
          );
          complete(result);
        },
      },
    },
    "node:fs": fs,
    "node:path": path,
    yaml: YAML,
    tar: {
      x: async ({ cwd }: { cwd: string }) => {
        const gameBackupPath = path.join(cwd, objectId);
        const source = path.join(gameBackupPath, destination);
        fs.mkdirSync(path.dirname(source), { recursive: true });
        fs.writeFileSync(source, "legacy save contents");
        fs.writeFileSync(
          path.join(gameBackupPath, "mapping.yaml"),
          YAML.stringify({
            backups: [{ files: { [destination]: {} } }],
            drives: {},
          })
        );
      },
    },
    axios: {
      get: async (url: string) => {
        urls.push(url);
        return { data: Readable.from([Buffer.from("archive")]) };
      },
    },
    "../register-event": {
      registerEvent: (name: string, callback: typeof listener) => {
        assert.equal(name, "downloadGameArtifact");
        listener = callback;
      },
    },
    "@main/constants": {
      backupsPath: path.join(root, "backups"),
      publicProfilePath: "/public-profile",
    },
    "@main/helpers": {
      addTrailingSlash: (value: string) => `${value}/`,
      normalizePath: (value: string) => value,
    },
    "@main/services/system-path": { SystemPath: { getPath: () => root } },
    "@main/level": {
      gamesSublevel: { get: async () => game },
      levelKeys: { game: () => "game-key" },
    },
    "@main/services/cloud-save/legacy-cloud-save-policy": {
      assertLegacyCloudSaveWriteAllowed,
    },
    "./game-artifact-download": {
      requestGameArtifactDownload: async (artifactId: string) => {
        requests.push(artifactId);
        if (requestFails) throw new Error("download unavailable");
        return {
          downloadUrl: "https://example.test/legacy-artifact",
          objectKey: "artifact.tar",
          homeDir: "/original-profile",
          winePrefixPath: null,
        };
      },
    },
  };

  try {
    runInNewContext(handlerCode, {
      exports: {},
      require: (id: string) => {
        assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
        return dependencies[id];
      },
    });
    await listener({} as IpcMainInvokeEvent, objectId, shop, "artifact-id");
    const success = await completion;
    return {
      success,
      requests,
      urls,
      contents: fs.existsSync(destination)
        ? fs.readFileSync(destination, "utf8")
        : null,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

describe("legacy GameArtifact downloads", () => {
  for (const platform of [
    "Sony PlayStation 3",
    "Nintendo Entertainment System",
    "Super Nintendo Entertainment System",
    "Nintendo 64",
    "Nintendo Game Boy",
    "Nintendo Game Boy Color",
    "Nintendo Game Boy Advance",
  ]) {
    it(
      `restores existing backups for LaunchBox ${platform}`,
      { timeout: 3000 },
      async () => {
        const result = await runDownload({ shop: "launchbox", platform });
        assert.equal(result.success, true);
        assert.deepEqual(result.requests, ["artifact-id"]);
        assert.deepEqual(result.urls, ["https://example.test/legacy-artifact"]);
        assert.equal(result.contents, "legacy save contents");
      }
    );
  }

  it(
    "preserves Steam, other consoles, and missing game records",
    { timeout: 3000 },
    async () => {
      for (const game of [
        { shop: "steam" as const, platform: "Sony PlayStation 3" },
        { shop: "launchbox" as const, platform: "Sony PlayStation 2" },
        null,
      ]) {
        const result = await runDownload(game);
        assert.equal(result.success, true);
        assert.equal(result.contents, "legacy save contents");
      }
    }
  );

  it(
    "still reports genuine download failures without restoring files",
    { timeout: 3000 },
    async () => {
      const result = await runDownload(
        { shop: "launchbox", platform: "Sony PlayStation 3" },
        true
      );
      assert.equal(result.success, false);
      assert.deepEqual(result.requests, ["artifact-id"]);
      assert.deepEqual(result.urls, []);
      assert.equal(result.contents, null);
    }
  );
});
