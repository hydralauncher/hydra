import test from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  findOrphanedDependencies,
  parseDependency,
  resolveInstallPlan,
} from "./dependencies.js";
import { LOADERS, isSafeRelativePath, toSupportedLoader } from "./loaders.js";
import type { ThunderstorePackage } from "../../../types/mods.types";

const pkg = (
  fullName: string,
  versions: [string, string[]][]
): ThunderstorePackage => ({
  fullName,
  owner: fullName.split("-")[0],
  name: fullName.split("-").slice(1).join("-"),
  description: "",
  icon: "",
  rating: 0,
  downloads: 0,
  categories: [],
  isDeprecated: false,
  isNsfw: false,
  dateUpdated: "",
  packageUrl: "",
  versions: versions.map(([version, dependencies]) => ({
    version,
    dependencies,
    downloadUrl: `https://x/${fullName}/${version}`,
    fileSize: 1,
  })),
});

const index = new Map(
  [
    pkg("bbepis-BepInExPack", [
      ["5.4.2100", []],
      ["5.4.2000", []],
    ]),
    pkg("A-ModA", [
      ["1.0.0", ["bbepis-BepInExPack-5.4.2000", "B-Lib_B-1.0.0"]],
    ]),
    pkg("B-Lib_B", [["1.2.0", ["bbepis-BepInExPack-5.4.2000"]]]),
    pkg("C-Cyc", [["1.0.0", ["D-Cyc2-1.0.0"]]]),
    pkg("D-Cyc2", [["1.0.0", ["C-Cyc-1.0.0"]]]),
    pkg("E-Broken", [["1.0.0", ["Nope-Missing-1.0.0"]]]),
  ].map((p) => [p.fullName, p])
);

test("parseDependency handles underscores and dashes in names", () => {
  assert.deepEqual(parseDependency("B-Lib_B-1.0.0"), {
    owner: "B",
    name: "Lib_B",
    version: "1.0.0",
    fullName: "B-Lib_B",
  });
  assert.equal(parseDependency("garbage"), null);
});

test("compareVersions", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.equal(compareVersions("0.9.9", "1.0.0"), -1);
});

test("plan installs dependencies first, loader once, newest version", () => {
  const { plan, missing } = resolveInstallPlan("A-ModA", index, {});
  assert.deepEqual(
    plan.map((p) => p.fullName),
    ["bbepis-BepInExPack", "B-Lib_B", "A-ModA"]
  );
  assert.equal(plan[0].version, "5.4.2100");
  assert.equal(plan[2].isDependency, false);
  assert.deepEqual(missing, []);
});

test("installed deps that satisfy the minimum are skipped", () => {
  const { plan } = resolveInstallPlan("A-ModA", index, {
    "bbepis-BepInExPack": { version: "5.4.2000" },
  });
  assert.deepEqual(
    plan.map((p) => p.fullName),
    ["B-Lib_B", "A-ModA"]
  );
});

test("cycles terminate and missing deps are reported", () => {
  assert.equal(resolveInstallPlan("C-Cyc", index, {}).plan.length, 2);
  assert.deepEqual(resolveInstallPlan("E-Broken", index, {}).missing, [
    "Nope-Missing",
  ]);
});

test("orphan detection keeps deps of explicitly installed mods", () => {
  const installed = {
    "A-ModA": { isDependency: false },
    "B-Lib_B": { isDependency: true },
    "bbepis-BepInExPack": { isDependency: true },
    "C-Cyc": { isDependency: true },
  };
  const versions = {
    "A-ModA": "1.0.0",
    "B-Lib_B": "1.2.0",
    "bbepis-BepInExPack": "5.4.2100",
    "C-Cyc": "1.0.0",
  };
  assert.deepEqual(findOrphanedDependencies(installed, index, versions), [
    "C-Cyc",
  ]);
});

test("bepinex loader strips wrapper folder, skips meta files", () => {
  const moves = LOADERS.bepinex.planLoader([
    "manifest.json",
    "icon.png",
    "BepInExPack/winhttp.dll",
    "BepInExPack/BepInEx/core/BepInEx.dll",
  ]);
  assert.deepEqual(
    moves.map((m) => m.to),
    ["winhttp.dll", "BepInEx/core/BepInEx.dll"]
  );
});

test("bepinex mod layouts", () => {
  const m = (files: string[]) =>
    LOADERS.bepinex.planMod(files, "A-ModA").map((x) => x.to);
  assert.deepEqual(m(["manifest.json", "Mod.dll"]), [
    "BepInEx/plugins/A-ModA/Mod.dll",
  ]);
  assert.deepEqual(m(["plugins/Mod.dll", "config/a.cfg"]), [
    "BepInEx/plugins/A-ModA/Mod.dll",
    "BepInEx/config/a.cfg",
  ]);
  assert.deepEqual(m(["BepInEx/plugins/Mod.dll"]), ["BepInEx/plugins/Mod.dll"]);
  assert.deepEqual(m(["Stuff/data.json"]), [
    "BepInEx/plugins/A-ModA/Stuff/data.json",
  ]);
});

test("melonloader mod layouts", () => {
  const m = (files: string[]) =>
    LOADERS.melonloader.planMod(files, "A-ModA").map((x) => x.to);
  assert.deepEqual(m(["Mods/x.dll", "UserLibs/y.dll", "z.dll"]), [
    "Mods/x.dll",
    "UserLibs/y.dll",
    "Mods/z.dll",
  ]);
});

test("path safety and loader mapping", () => {
  assert.equal(isSafeRelativePath("BepInEx/plugins/a.dll"), true);
  assert.equal(isSafeRelativePath("../evil.dll"), false);
  assert.equal(isSafeRelativePath("a/../../evil"), false);
  assert.equal(isSafeRelativePath("C:/evil"), false);
  assert.equal(toSupportedLoader("bepinex"), "bepinex");
  assert.equal(toSupportedLoader("gdweave"), null);
  assert.equal(toSupportedLoader(undefined), "bepinex");
});
