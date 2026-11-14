import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

import type { CloudSavePathContext, RecompilationSaveRule } from "@types";

type GetRules = (
  pathContext: CloudSavePathContext,
  launchExecutablePath?: string | null
) => RecompilationSaveRule[] | undefined;

const ROAMING = "C:/Users/Player/AppData/Roaming";
const XDG_DATA = "/home/player/{custom}/data";
const ORIGINAL_ENV = {
  APPDATA: process.env.APPDATA,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};

let root: string;
let getRecompilationSaveRules: GetRules;

before(async () => {
  process.env.APPDATA = ROAMING;
  process.env.XDG_DATA_HOME = XDG_DATA;

  root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-recomp-saves-"));
  const bundlePath = path.join(root, "recompilation-cloud-save.mjs");
  const fromHere = (relative: string) =>
    fileURLToPath(new URL(relative, import.meta.url));

  await build({
    entryPoints: [fromHere("./recompilation-cloud-save.ts")],
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
            path: fromHere("../../../shared/recompilations.ts"),
          }));
          pluginBuild.onResolve(
            { filter: /recompilation-saves\.json$/ },
            () => ({
              path: fromHere(
                "../../events/recompilation/recompilation-saves.json"
              ),
            })
          );
          pluginBuild.onResolve({ filter: /recompilation-paths$/ }, () => ({
            path: fromHere("../../events/recompilation/recompilation-paths.ts"),
          }));
          pluginBuild.onResolve(
            {
              filter:
                /^@main\/level$|recompilation-installer$|get-downloads-path$|^@types$/,
            },
            (args) => ({ path: args.path, namespace: "stub" })
          );
          pluginBuild.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents: [
              "export const gamesSublevel = {};",
              "export const levelKeys = {};",
              "export const recompilationInstallsSublevel = {};",
              "export const getRecompilationInstallState = async () => null;",
              "export const getDownloadsPath = async () => '';",
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
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(root, { recursive: true, force: true });
});

const context = (
  objectId: string,
  platform: CloudSavePathContext["platform"],
  executablePath?: string
): CloudSavePathContext => ({
  shop: "launchbox",
  objectId,
  platform,
  homeDir: platform === "windows" ? "C:/Users/Player" : "/home/player",
  executablePath,
  storeUserContext: {} as CloudSavePathContext["storeUserContext"],
});

const folder = (
  objectId: string,
  platform: CloudSavePathContext["platform"],
  rawPath: string,
  executablePath?: string
) =>
  getRecompilationSaveRules(context(objectId, platform, executablePath))?.find(
    (rule) => rule.rawPath === rawPath
  )?.preferredPath;

describe("getRecompilationSaveRules", () => {
  it("names a per-OS save location the same on Windows and Linux", () => {
    const names = (platform: "windows" | "linux") =>
      getRecompilationSaveRules(context("2234:gen1recomp", platform))?.map(
        ({ rawPath, kind }) => [rawPath, kind]
      );

    assert.deepEqual(names("windows"), names("linux"));
    assert.ok(
      names("linux")?.some(([rawPath]) => rawPath === "<recompilation>/saves/")
    );
  });

  it("points each machine at its own folder, literally", () => {
    assert.equal(
      folder("2234:gen1recomp", "windows", "<recompilation>/saves/"),
      path.normalize(`${ROAMING}/pokemon-love2d/saves/`)
    );
    assert.equal(
      folder("2234:gen1recomp", "linux", "<recompilation>/saves/"),
      path.normalize(`${XDG_DATA}/pokemon-love2d/saves/`)
    );
    assert.equal(
      folder("2234:gen1recomp", "linux", "<recompilation>/box/storage.lua"),
      path.normalize(`${XDG_DATA}/pokemon-love2d/box/storage.lua`)
    );
  });

  it("uses the port's executable folder for <base>", () => {
    assert.equal(
      folder(
        "153:shipwright",
        "windows",
        "<recompilation>/Save/",
        "D:/Games/recompilations/shipwright/soh.exe"
      ),
      path.normalize("D:/Games/recompilations/shipwright/Save/")
    );
    assert.equal(
      folder("153:shipwright", "windows", "<recompilation>/Save/"),
      undefined
    );
  });

  // Hydra runs the extracted AppImage without APPIMAGE set, so Ship of Harkinian
  // keeps its files in the folder it is launched from on Linux too.
  it("keeps Ship of Harkinian's Linux saves in the port's folder", () => {
    assert.equal(
      folder(
        "153:shipwright",
        "linux",
        "<recompilation>/Save/",
        "/home/player/recompilations/shipwright/AppRun"
      ),
      path.normalize("/home/player/recompilations/shipwright/Save/")
    );
  });

  it("uses the folder Hydra launches the port from, not where AppRun links to", () => {
    const rules = getRecompilationSaveRules(
      context(
        "153:shipwright",
        "linux",
        "/home/player/recompilations/shipwright/usr/bin/soh.elf"
      ),
      "/home/player/recompilations/shipwright/AppRun"
    );

    assert.equal(
      rules?.find((rule) => rule.rawPath === "<recompilation>/Save/")
        ?.preferredPath,
      path.normalize("/home/player/recompilations/shipwright/Save/")
    );
  });

  it("leaves a location for other machines on an OS without its folder", () => {
    assert.deepEqual(
      getRecompilationSaveRules(context("153:shipwright", "mac", "/Apps/soh")),
      [
        {
          rawPath: "<recompilation>/Save/",
          kind: "dir",
          tags: ["save"],
          when: [{ os: "windows" }, { os: "linux" }],
        },
      ]
    );
  });

  it("falls back to ~/.local/share when XDG_DATA_HOME is empty", () => {
    process.env.XDG_DATA_HOME = "";
    try {
      assert.equal(
        folder("2234:gen1recomp", "linux", "<recompilation>/saves/"),
        path.normalize(`${os.homedir()}/.local/share/pokemon-love2d/saves/`)
      );
    } finally {
      process.env.XDG_DATA_HOME = XDG_DATA;
    }
  });

  it("keeps locations that are the same on every OS as plain rules", () => {
    assert.deepEqual(
      getRecompilationSaveRules(context("204:ghostship", "linux")),
      [{ rawPath: "<base>/saves/", kind: "dir", tags: ["save"], when: [] }]
    );
  });

  it("ignores games that are not ports", () => {
    assert.equal(
      getRecompilationSaveRules(context("2234", "linux")),
      undefined
    );
  });
});
