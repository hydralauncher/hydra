import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

type FindGameInstaller = (folderPath: string) => Promise<string | null>;

let root: string;
let findGameInstaller: FindGameInstaller;

const createLayout = async (name: string, files: string[]) => {
  const folder = path.join(root, name);

  for (const file of files) {
    const filePath = path.join(folder, file);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "");
  }

  return folder;
};

const installerIn = async (name: string, files: string[]) => {
  const folder = await createLayout(name, files);
  const installer = await findGameInstaller(folder);

  return installer ? path.relative(folder, installer) : null;
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-installer-"));

  const bundlePath = path.join(root, "find-game-installer.mjs");
  const stubs: Record<string, string> = {
    "@main/services/logger": "export const logger = { error() {} };",
    "@main/events/helpers/get-downloads-path":
      "export const getDownloadsPath = async () => '';",
  };

  await build({
    entryPoints: [
      fileURLToPath(new URL("./find-game-installer.ts", import.meta.url)),
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: bundlePath,
    logLevel: "silent",
    plugins: [
      {
        name: "stubs",
        setup(pluginBuild) {
          pluginBuild.onResolve({ filter: /^@main\// }, (args) => ({
            path: args.path,
            namespace: "stub",
          }));
          pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: stubs[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });

  ({ findGameInstaller } = await import(pathToFileURL(bundlePath).href));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("findGameInstaller", () => {
  it("finds setup.exe at the top of the folder", async () => {
    assert.equal(
      await installerIn("top", ["setup.exe", "data1.bin"]),
      "setup.exe"
    );
  });

  it("finds an installer wrapped in a folder", async () => {
    assert.equal(
      await installerIn("wrapped", ["Game/setup.exe", "Game/data1.bin"]),
      path.join("Game", "setup.exe")
    );
  });

  it("matches installer names regardless of case", async () => {
    assert.equal(
      await installerIn("mixed-case", ["Setup.EXE", "vc_redist.x64.exe"]),
      "Setup.EXE"
    );
  });

  it("prefers setup.exe over other installer names", async () => {
    assert.equal(
      await installerIn("preferred", ["install_game.exe", "setup.exe"]),
      "setup.exe"
    );
  });

  it("accepts setup and install prefixed installers", async () => {
    assert.equal(
      await installerIn("prefixed", [
        "setup_game_1.0.exe",
        "setup_game_1.0-1.bin",
      ]),
      "setup_game_1.0.exe"
    );
  });

  it("skips installers inside redistributable folders", async () => {
    assert.equal(
      await installerIn("redist", [
        "Game.exe",
        "_CommonRedist/DirectX/setup.exe",
      ]),
      null
    );
  });

  it("does not treat an installed game as an installer", async () => {
    assert.equal(
      await installerIn("installed", ["Game.exe", "UnityCrashHandler64.exe"]),
      null
    );
  });

  it("prefers the base installer over DLC installers at the same level", async () => {
    assert.equal(
      await installerIn("gog", [
        "setup_game_1.0.exe",
        "setup_game_dlc_soundtrack_1.0.exe",
      ]),
      "setup_game_1.0.exe"
    );
  });

  it("gives up when two installers tie", async () => {
    assert.equal(
      await installerIn("tied", ["Part1/setup.exe", "Part2/setup.exe"]),
      null
    );
  });

  it("does not search deeper than two folders", async () => {
    assert.equal(await installerIn("deep", ["a/b/c/setup.exe"]), null);
  });
});
