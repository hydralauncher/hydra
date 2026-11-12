import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

type InstallerProcess = {
  exe: string | null;
  name: string;
  peExecutablePath?: string | null;
};

type IsInstallerProcess = (
  process: InstallerProcess,
  installerPath: string
) => boolean;

let root: string;
let isInstallerProcess: IsInstallerProcess;

const originalPlatform = process.platform;

const onPlatform = <T>(platform: NodeJS.Platform, run: () => T): T => {
  Object.defineProperty(process, "platform", { value: platform });
  try {
    return run();
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
};

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-recovery-"));
  const bundlePath = path.join(root, "recover-interrupted-installers.mjs");

  await build({
    entryPoints: [
      fileURLToPath(
        new URL("./recover-interrupted-installers.ts", import.meta.url)
      ),
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
          pluginBuild.onResolve(
            { filter: /^@main\/|^\.\/installed-executable-poller$/ },
            (args) => ({ path: args.path, namespace: "stub" })
          );
          pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: [
              "export const downloadsSublevel = {};",
              "export const gamesSublevel = {};",
              "export const levelKeys = {};",
              "export const GameExecutables = {};",
              "export class GameFilesManager {}",
              "export const logger = {};",
              "export const NativeAddon = {};",
              "export const Wine = {};",
              "export const WindowManager = {};",
              "export const endInstallerRun = () => {};",
              "export const markInstallerRunLive = () => {};",
            ].join("\n"),
            loader: "js",
          }));
        },
      },
    ],
  });

  ({ isInstallerProcess } = await import(pathToFileURL(bundlePath).href));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("isInstallerProcess on Windows", () => {
  const installer = String.raw`D:\Games\Example\setup.exe`;
  const matches = (process: InstallerProcess) =>
    onPlatform("win32", () => isInstallerProcess(process, installer));

  it("matches the same executable path ignoring case", () => {
    assert.equal(
      matches({
        exe: String.raw`d:\games\example\SETUP.EXE`,
        name: "setup.exe",
      }),
      true
    );
  });

  it("falls back to the name when the path can't be read", () => {
    assert.equal(matches({ exe: null, name: "setup.exe" }), true);
  });

  it("ignores a setup.exe running from another folder", () => {
    assert.equal(
      matches({ exe: String.raw`C:\Other\setup.exe`, name: "setup.exe" }),
      false
    );
  });
});

describe("isInstallerProcess on Linux", () => {
  const installer = "/home/user/Downloads/Example/setup_example_1.0.exe";
  const matches = (process: InstallerProcess) =>
    onPlatform("linux", () => isInstallerProcess(process, installer));

  it("matches the Wine process by its full name", () => {
    assert.equal(
      matches({
        exe: "/usr/bin/wine64-preloader",
        name: "setup_example_1.0.exe",
      }),
      true
    );
  });

  it("matches the 15-character comm the kernel keeps", () => {
    assert.equal(
      matches({ exe: "/usr/bin/wine64-preloader", name: "setup_example_1" }),
      true
    );
  });

  it("compares the full path when Wine reports a Z: drive path", () => {
    assert.equal(
      matches({
        exe: "/usr/bin/wine64-preloader",
        name: "x",
        peExecutablePath: String.raw`Z:\home\user\Downloads\Example\setup_example_1.0.exe`,
      }),
      true
    );
    assert.equal(
      matches({
        exe: "/usr/bin/wine64-preloader",
        name: "x",
        peExecutablePath: String.raw`Z:\home\user\Downloads\Other\setup_example_1.0.exe`,
      }),
      false
    );
  });

  it("ignores other Wine programs and short unrelated names", () => {
    assert.equal(
      matches({ exe: "/usr/bin/wine64-preloader", name: "explorer.exe" }),
      false
    );
    assert.equal(
      matches({ exe: "/usr/bin/wine64-preloader", name: "setup" }),
      false
    );
  });
});
