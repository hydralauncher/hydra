import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { gamesSublevel } from "@main/level";
import type { Game, UserLocationCoverage } from "@types";
import {
  getCloudSaveRetroArchPlatform,
  getRetroArchRomExtensions,
} from "@shared";

import { getRetroArchConfig } from "../retroarch/retroarch-repository";
import {
  PLATFORM_TO_CORE,
  RETROARCH_CORES,
} from "../retroarch/retroarch-cores";
import { hashRomFile } from "../retroarch/rom-hash";
import { findRetroArchConfig } from "../emulators/emulator-souvenir-config";
import {
  emulatorSaveFileKey,
  emulatorRestoreRule,
  parseRetroArchSaveRawPath,
  retroArchSaveRawPath,
} from "./emulator-provider-identity";
import {
  parseRetroArchSaveConfig,
  resolveRetroArchOverrideDirectory,
  resolveRetroArchSaveDirectory,
  RETROARCH_SAVE_SUFFIXES,
  retroArchLogicalSaveName,
  retroArchPhysicalSaveName,
  retroArchSaveStem,
  shouldLoadRetroArchOverrides,
  type RetroArchSaveConfig,
} from "./retroarch-save-config";
import type {
  EmulatorProvider,
  EmulatorProviderContext,
  EmulatorProviderDiscovery,
} from "./emulator-provider-types";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const coverage = (
  rawPath: string,
  variantId: string,
  complete: boolean
): UserLocationCoverage => ({
  candidateId: hash(rawPath),
  ruleId: hash(JSON.stringify(["emulator", rawPath])),
  variantId,
  rawPath,
  selectedRoot: true,
  authority: "exact",
  outcome: complete ? "scanned" : "partial",
  enumeratedCompletely: complete,
  warningCodes: complete ? [] : ["retroarch-location-partial"],
});

const unresolvedCoverage = (reason: string): UserLocationCoverage => ({
  candidateId: hash(reason),
  ruleId: hash("emulator:retroarch"),
  rawPath: "<emulator>/retroarch/unresolved",
  selectedRoot: false,
  authority: "inferred",
  outcome: "unresolved",
  enumeratedCompletely: false,
  warningCodes: [reason],
});

const readConfig = async (configPath: string) =>
  parseRetroArchSaveConfig(await fs.readFile(configPath, "utf8"));

const mergeOverrides = async (
  configPath: string,
  values: RetroArchSaveConfig,
  romPath: string,
  coreName: string
) => {
  if (!shouldLoadRetroArchOverrides(values)) return values;
  const configDirectory = resolveRetroArchOverrideDirectory(
    values,
    configPath,
    os.homedir()
  );
  const coreDirectory = path.join(configDirectory, coreName);
  const candidates = [
    path.join(coreDirectory, `${coreName}.cfg`),
    path.join(coreDirectory, `${path.basename(path.dirname(romPath))}.cfg`),
    path.join(coreDirectory, `${path.parse(romPath).name}.cfg`),
  ];
  let effective = { ...values };
  for (const candidate of candidates) {
    const content = await fs
      .readFile(candidate, "utf8")
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (content !== null) {
      effective = { ...effective, ...parseRetroArchSaveConfig(content) };
    }
  }
  return effective;
};

export const getRetroArchSaveEnvironmentKey = async (game: Game) => {
  const platform = getCloudSaveRetroArchPlatform(game.shop, game.platform);
  if (!platform) return "retroarch-platform-unresolved";
  const emulator = await getRetroArchConfig().catch(() => null);
  const configPath = emulator?.executablePath
    ? findRetroArchConfig(emulator.executablePath)
    : null;
  if (!configPath) return "retroarch-config-unresolved";
  const core = PLATFORM_TO_CORE[platform];
  const coreName = RETROARCH_CORES[core].displayName;
  try {
    const baseConfig = await readConfig(configPath);
    const locations = await Promise.all(
      (game.discs ?? []).map(async (disc) => {
        const values = await mergeOverrides(
          configPath,
          baseConfig,
          disc.path,
          coreName
        );
        return [
          path.resolve(disc.path),
          resolveRetroArchSaveDirectory({
            values,
            configPath,
            homeDir: os.homedir(),
            romPath: disc.path,
            coreName,
          }),
        ];
      })
    );
    if (locations.some(([, directory]) => directory === null)) {
      return "retroarch-save-directory-unresolved";
    }
    return JSON.stringify([path.resolve(configPath), locations.sort()]);
  } catch {
    return "retroarch-save-config-unresolved";
  }
};

interface RomSaveLocation {
  rawPath: string;
  romPath: string;
  saveDirectory: string;
  stem: string;
}

const conflictingRomStems = async (game: Game) => {
  const ownStems = new Set(
    (game.discs ?? []).map((disc) => retroArchSaveStem(disc.path))
  );
  const conflicts = new Set<string>();
  if (ownStems.size === 0) return conflicts;
  for await (const [, other] of gamesSublevel.iterator()) {
    const otherPlatform = getCloudSaveRetroArchPlatform(
      other.shop,
      other.platform
    );
    if (
      other.shop !== "launchbox" ||
      other.objectId === game.objectId ||
      other.isDeleted ||
      !otherPlatform
    ) {
      continue;
    }
    const allowedExtensions = new Set(getRetroArchRomExtensions(otherPlatform));
    for (const disc of other.discs ?? []) {
      const stem = retroArchSaveStem(disc.path);
      if (!ownStems.has(stem)) continue;
      if (
        !allowedExtensions.has(path.extname(disc.path).slice(1).toLowerCase())
      ) {
        continue;
      }
      const stat = await fs.lstat(disc.path).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) conflicts.add(stem);
    }
  }
  return conflicts;
};

const locationsForGame = async (game: Game) => {
  const platform = getCloudSaveRetroArchPlatform(game.shop, game.platform);
  if (!platform) throw new Error("cloud_save_retroarch_platform_unknown");
  const emulator = await getRetroArchConfig();
  if (!emulator.executablePath) {
    throw new Error("cloud_save_retroarch_not_configured");
  }
  const configPath = findRetroArchConfig(emulator.executablePath);
  if (!configPath) throw new Error("cloud_save_retroarch_config_unresolved");
  const core = PLATFORM_TO_CORE[platform];
  const installedCore = emulator.cores[core];
  if (!installedCore?.installed || !installedCore.path) {
    throw new Error("cloud_save_retroarch_core_unavailable");
  }
  const baseConfig = await readConfig(configPath);
  const allowedExtensions = new Set(getRetroArchRomExtensions(platform));
  const locations: RomSaveLocation[] = [];
  let unresolved = false;
  const seenHashes = new Set<string>();
  const duplicateHashes = new Set<string>();
  for (const disc of game.discs ?? []) {
    const romPath = disc.path;
    const extension = path.extname(romPath).slice(1).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      unresolved = true;
      continue;
    }
    const stat = await fs.lstat(romPath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      unresolved = true;
      continue;
    }
    const romHash = await hashRomFile(romPath, platform);
    if (!romHash) {
      unresolved = true;
      continue;
    }
    if (seenHashes.has(romHash)) {
      unresolved = true;
      duplicateHashes.add(romHash);
      continue;
    }
    seenHashes.add(romHash);
    const coreName = RETROARCH_CORES[core].displayName;
    let values: RetroArchSaveConfig;
    try {
      values = await mergeOverrides(configPath, baseConfig, romPath, coreName);
    } catch {
      unresolved = true;
      continue;
    }
    const saveDirectory = resolveRetroArchSaveDirectory({
      values,
      configPath,
      homeDir: os.homedir(),
      romPath,
      coreName,
    });
    if (!saveDirectory) {
      unresolved = true;
      continue;
    }
    locations.push({
      rawPath: retroArchSaveRawPath(platform, romHash),
      romPath,
      saveDirectory,
      stem: path.parse(romPath).name,
    });
  }
  if (!locations.length && !unresolved) unresolved = true;
  const conflictingStems = await conflictingRomStems(game);
  if (conflictingStems.size > 0) unresolved = true;
  return {
    locations: locations.filter(
      (location) =>
        !duplicateHashes.has(
          parseRetroArchSaveRawPath(location.rawPath)!.romHash
        ) && !conflictingStems.has(retroArchSaveStem(location.romPath))
    ),
    unresolved,
    platform,
  };
};

const isSafeFileTarget = async (directory: string, filePath: string) => {
  if (path.dirname(filePath) !== directory) return false;
  const directoryStat = await fs.lstat(directory).catch(() => null);
  if (directoryStat?.isSymbolicLink()) return false;
  const fileStat = await fs.lstat(filePath).catch(() => null);
  return !fileStat?.isSymbolicLink();
};

export const retroArchSaveProvider: EmulatorProvider = {
  async discover({ game, environmentId, variantId }: EmulatorProviderContext) {
    const result: EmulatorProviderDiscovery = {
      files: [],
      coverage: [],
      revision: "retroarch-v1",
    };
    let locations: RomSaveLocation[];
    let unresolved: boolean;
    try {
      ({ locations, unresolved } = await locationsForGame(game));
    } catch {
      result.coverage.push(unresolvedCoverage("retroarch-config-unresolved"));
      return result;
    }
    if (unresolved) {
      result.coverage.push(unresolvedCoverage("retroarch-rom-unresolved"));
    }
    const targetOwners = new Map<string, string>();
    const collidingTargets = new Set<string>();
    for (const location of locations) {
      for (const suffix of RETROARCH_SAVE_SUFFIXES) {
        const target = path.join(
          location.saveDirectory,
          `${location.stem}${suffix}`
        );
        const owner = targetOwners.get(target);
        if (owner && owner !== location.rawPath) collidingTargets.add(target);
        targetOwners.set(target, location.rawPath);
      }
    }
    for (const location of locations) {
      let complete = true;
      for (const suffix of RETROARCH_SAVE_SUFFIXES) {
        const filePath = path.join(
          location.saveDirectory,
          `${location.stem}${suffix}`
        );
        if (collidingTargets.has(filePath)) {
          complete = false;
          continue;
        }
        const stat = await fs.lstat(filePath).catch(() => null);
        if (!stat) continue;
        if (!stat.isFile() || stat.isSymbolicLink()) {
          complete = false;
          continue;
        }
        const relativePath = retroArchLogicalSaveName(suffix)!;
        result.files.push({
          variantId,
          ruleId: hash(JSON.stringify(["emulator", location.rawPath])),
          rawPath: location.rawPath,
          absolutePath: filePath,
          relativePath,
          localBindings: {
            environmentId,
            rootId: hash(
              JSON.stringify([environmentId, location.saveDirectory])
            ),
            concreteUserSegment: "__default__",
            concretePath: location.saveDirectory,
          },
          confidence: "exact",
          provenance: ["emulator:retroarch"],
        });
      }
      result.coverage.push(coverage(location.rawPath, variantId, complete));
    }
    return result;
  },
  async restoreRules(game: Game, files) {
    let locations: RomSaveLocation[];
    try {
      ({ locations } = await locationsForGame(game));
    } catch {
      return new Map();
    }
    const locationByRawPath = new Map(
      locations.map((location) => [location.rawPath, location])
    );
    const rules = new Map<string, ReturnType<typeof emulatorRestoreRule>>();
    const targetOwners = new Map<string, string>();
    const collidingTargets = new Set<string>();
    for (const location of locations) {
      for (const suffix of RETROARCH_SAVE_SUFFIXES) {
        const target = path.join(
          location.saveDirectory,
          `${location.stem}${suffix}`
        );
        const owner = targetOwners.get(target);
        if (owner && owner !== location.rawPath) collidingTargets.add(target);
        targetOwners.set(target, location.rawPath);
      }
    }
    for (const file of files) {
      const parsed = parseRetroArchSaveRawPath(file.rawPath);
      const location = locationByRawPath.get(file.rawPath);
      const fileName = location
        ? retroArchPhysicalSaveName(location.romPath, file.relativePath)
        : null;
      if (!parsed || !location || !fileName) continue;
      const target = path.join(location.saveDirectory, fileName);
      if (collidingTargets.has(target)) continue;
      if (!(await isSafeFileTarget(location.saveDirectory, target))) continue;
      rules.set(
        emulatorSaveFileKey(file),
        emulatorRestoreRule(file.rawPath, target, "file")
      );
    }
    return rules;
  },
};
