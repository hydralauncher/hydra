import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

import type { CloudSavePathContext, RecompilationSaveRule } from "@types";

type GetRules = (
  pathContext: CloudSavePathContext
) => RecompilationSaveRule[] | undefined;

// Stand-in for the native resolver: the folders each OS would resolve to.
const LOCAL_FOLDERS: Record<string, Record<string, string>> = {
  windows: {
    "<winAppData>": "C:/Users/Player/AppData/Roaming",
    "<base>": "D:/Games/recompilations/shipwright",
  },
  linux: {
    "<xdgData>": "/home/player/.local/share",
    "<base>": "/home/player/recompilations/shipwright",
  },
};

let root: string;
let getRecompilationSaveRules: GetRules;

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-recomp-saves-"));
  const bundlePath = path.join(root, "recompilation-cloud-save.mjs");
  const shared = fileURLToPath(
    new URL("../../../shared/recompilations.ts", import.meta.url)
  );
  const saveMap = fileURLToPath(
    new URL(
      "../../events/recompilation/recompilation-saves.json",
      import.meta.url
    )
  );

  await build({
    entryPoints: [
      fileURLToPath(new URL("./recompilation-cloud-save.ts", import.meta.url)),
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
          pluginBuild.onResolve({ filter: /^@shared$/ }, () => ({
            path: shared,
          }));
          pluginBuild.onResolve(
            { filter: /recompilation-saves.json$/ },
            () => ({
              path: saveMap,
            })
          );
          pluginBuild.onResolve(
            {
              filter:
                /^@main\/level$|recompilation-installer$|^\.\.\/native-addon$/,
            },
            (args) => ({ path: args.path, namespace: "stub" })
          );
          pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: [
              "export const gamesSublevel = {};",
              "export const levelKeys = {};",
              "export const getRecompilationInstallState = async () => null;",
              `const folders = ${JSON.stringify(LOCAL_FOLDERS)};`,
              "export const NativeAddon = {",
              "  resolveSaveRules: ({ platform, rules }) => rules.map((rule) => ({",
              "    ...rule,",
              "    resolvedPaths: [{ path: rule.rawPath.replace(/<[A-Za-z]+>/g, (token) => folders[platform][token]), caseSensitive: false, dynamic: false }],",
              "    unresolvedTokens: [],",
              "  })),",
              "};",
            ].join("\n"),
            loader: "js",
          }));
        },
      },
    ],
  });

  ({ getRecompilationSaveRules } = await import(
    pathToFileURL(bundlePath).href
  ));
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const context = (
  objectId: string,
  platform: CloudSavePathContext["platform"]
): CloudSavePathContext => ({
  shop: "launchbox",
  objectId,
  platform,
  homeDir: platform === "windows" ? "C:/Users/Player" : "/home/player",
  storeUserContext: {} as CloudSavePathContext["storeUserContext"],
});

const rulesOn = (objectId: string, platform: "windows" | "linux") =>
  getRecompilationSaveRules(context(objectId, platform)) ?? [];

describe("getRecompilationSaveRules", () => {
  it("names a per-OS save folder the same on Windows and Linux", () => {
    const windows = rulesOn("2234:gen1recomp", "windows");
    const linux = rulesOn("2234:gen1recomp", "linux");

    assert.deepEqual(
      windows.map(({ rawPath, kind }) => [rawPath, kind]),
      linux.map(({ rawPath, kind }) => [rawPath, kind])
    );
    assert.ok(
      windows.some(({ rawPath }) => rawPath === "<recompilation>/saves/")
    );
  });

  it("points each machine at its own folder", () => {
    const folder = (platform: "windows" | "linux", rawPath: string) =>
      rulesOn("2234:gen1recomp", platform).find(
        (rule) => rule.rawPath === rawPath
      )?.preferredPath;

    assert.equal(
      folder("windows", "<recompilation>/saves/"),
      "C:/Users/Player/AppData/Roaming/pokemon-love2d/saves/"
    );
    assert.equal(
      folder("linux", "<recompilation>/saves/"),
      "/home/player/.local/share/pokemon-love2d/saves/"
    );
    assert.equal(
      folder("windows", "<recompilation>/box/storage.lua"),
      "C:/Users/Player/AppData/Roaming/pokemon-love2d/box/storage.lua"
    );
    assert.equal(
      folder("linux", "<recompilation>/box/storage.lua"),
      "/home/player/.local/share/pokemon-love2d/box/storage.lua"
    );
  });

  it("resolves the port folder only where the save lives in it", () => {
    assert.equal(
      rulesOn("153:shipwright", "windows")[0]?.preferredPath,
      "D:/Games/recompilations/shipwright/Save/"
    );
    assert.equal(
      rulesOn("153:shipwright", "linux")[0]?.preferredPath,
      "/home/player/.local/share/soh/Save/"
    );
  });

  it("keeps locations that are the same on every OS as plain rules", () => {
    const rules = rulesOn("204:ghostship", "linux");

    assert.deepEqual(rules, [
      { rawPath: "<base>/saves/", kind: "dir", tags: ["save"], when: [] },
    ]);
  });

  it("ignores games that are not ports", () => {
    assert.equal(
      getRecompilationSaveRules(context("2234", "linux")),
      undefined
    );
  });
});
