import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

type ResolveMacSteamClientPath = (
  steamRoot?: string | null,
  home?: string,
  existsSync?: (targetPath: string) => boolean
) => { path: string; hasNativeLibrary: boolean };

let root: string;
let resolveMacSteamClientPath: ResolveMacSteamClientPath;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-macos-compat-"));
  const bundlePath = path.join(root, "macos-compatibility.mjs");
  const stubs: Record<string, string> = {
    "@main/constants": "export const logsPath = '';",
    "@main/helpers/resolve-launch-command":
      "export const resolveLaunchCommand = () => ({ command: '', args: [], env: {} });",
    "./logger": "export const logger = { info() {}, warn() {}, error() {} };",
    "./steam":
      "export const getSteamLibraryFolders = async () => []; export const getSteamLocation = async () => null;",
    "./system-path":
      "export const SystemPath = { getPath: () => '/Users/test' };",
  };

  await build({
    entryPoints: [
      fileURLToPath(new URL("./macos-compatibility.ts", import.meta.url)),
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
          pluginBuild.onResolve({ filter: /.*/ }, (args) =>
            args.path in stubs
              ? { path: args.path, namespace: "stub" }
              : undefined
          );
          pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: stubs[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });

  ({ resolveMacSteamClientPath } = await import(
    pathToFileURL(bundlePath).href
  ));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("resolveMacSteamClientPath", () => {
  it("resolves Steam.AppBundle Contents/MacOS when steamclient.dylib exists", () => {
    const steamRoot = "/Users/alice/Library/Application Support/Steam";
    const expectedBundle = path.join(
      steamRoot,
      "Steam.AppBundle",
      "Steam",
      "Contents",
      "MacOS"
    );
    const result = resolveMacSteamClientPath(
      steamRoot,
      "/Users/alice",
      (candidate) =>
        candidate === path.join(expectedBundle, "steamclient.dylib")
    );

    assert.deepEqual(result, {
      path: expectedBundle,
      hasNativeLibrary: true,
    });
  });

  it("marks hasNativeLibrary false when steamclient.dylib is absent", () => {
    const result = resolveMacSteamClientPath(null, "/Users/alice", () => false);

    assert.deepEqual(result, {
      path: "/Users/alice/Library/Application Support/Steam/Steam.AppBundle/Steam/Contents/MacOS",
      hasNativeLibrary: false,
    });
  });
});
