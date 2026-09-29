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
  createRetroArchGameSaveFileFilter,
  resolveRetroArchConfiguredPath,
  resolveRetroArchOverrideDirectory,
  resolveRetroArchSaveDirectory,
  retroArchSaveStem,
  shouldLoadRetroArchOverrides,
  type RetroArchSaveConfig,
} from "./retroarch-save-config";
import {
  discoverRetroArchTargets,
  isSafeRetroArchFileTarget,
  retroArchTargetForFile,
  type RomSaveLocation,
} from "./retroarch-save-scanner";
import {
  retroArchSaveLocationsOverlap,
  type RetroArchSaveLayout,
} from "./retroarch-save-collision";
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

export const retroArchStateMetadataForGame = async (game: Game) => {
  const platform = getCloudSaveRetroArchPlatform(game.shop, game.platform);
  if (!platform) return null;
  return {
    emulatorId: "retroarch",
    coreId: PLATFORM_TO_CORE[platform],
  };
};

export const getRetroArchInstalledCoreVersion = async (
  game: Game
): Promise<string | null> => {
  const platform = getCloudSaveRetroArchPlatform(game.shop, game.platform);
  if (!platform) return null;
  const core = PLATFORM_TO_CORE[platform];
  const emulator = await getRetroArchConfig().catch(() => null);
  const corePath = emulator?.cores[core]?.path;
  if (!corePath) return null;
  const configPath = emulator?.executablePath
    ? findRetroArchConfig(emulator.executablePath)
    : null;
  const values = configPath
    ? await readConfig(configPath).catch(() => null)
    : null;
  const configuredInfoDir =
    values?.libretro_info_path &&
    values.libretro_info_path !== "default" &&
    configPath
      ? resolveRetroArchConfiguredPath(
          values.libretro_info_path,
          configPath,
          os.homedir()
        )
      : null;
  const infoName = `${path.parse(corePath).name}.info`;
  const infoDirectories = [
    configuredInfoDir,
    path.resolve(path.dirname(corePath), "..", "info"),
  ].filter((directory): directory is string => Boolean(directory));
  for (const directory of infoDirectories) {
    const content = await fs
      .readFile(path.join(directory, infoName), "utf8")
      .catch(() => null);
    if (!content) continue;
    const version = parseRetroArchSaveConfig(content).display_version;
    if (version) return version;
  }
  return null;
};

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

const configuredSaveLayout = async (
  romPath: string,
  platform: NonNullable<ReturnType<typeof getCloudSaveRetroArchPlatform>>,
  configPath: string,
  baseConfig: RetroArchSaveConfig
): Promise<RetroArchSaveLayout> => {
  const coreName = RETROARCH_CORES[PLATFORM_TO_CORE[platform]].displayName;
  const values = await mergeOverrides(
    configPath,
    baseConfig,
    romPath,
    coreName
  );
  return {
    romPath,
    saveDirectory: resolveRetroArchSaveDirectory({
      values,
      configPath,
      homeDir: os.homedir(),
      romPath,
      coreName,
    }),
    stateDirectory: resolveRetroArchSaveDirectory({
      values,
      configPath,
      homeDir: os.homedir(),
      romPath,
      coreName,
      kind: "state",
    }),
  };
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
          resolveRetroArchSaveDirectory({
            values,
            configPath,
            homeDir: os.homedir(),
            romPath: disc.path,
            coreName,
            kind: "state",
          }),
        ];
      })
    );
    return JSON.stringify([path.resolve(configPath), locations.sort()]);
  } catch {
    return "retroarch-save-config-unresolved";
  }
};

const conflictingRomStems = async (
  game: Game,
  knownConfig?: { configPath: string; baseConfig: RetroArchSaveConfig }
) => {
  const platform = getCloudSaveRetroArchPlatform(game.shop, game.platform);
  if (!platform) return new Set<string>();
  const ownStems = new Set(
    (game.discs ?? []).map((disc) => retroArchSaveStem(disc.path))
  );
  const conflicts = new Set<string>();
  if (ownStems.size === 0) return conflicts;
  const emulator = knownConfig
    ? null
    : await getRetroArchConfig().catch(() => null);
  const configPath =
    knownConfig?.configPath ??
    (emulator?.executablePath
      ? findRetroArchConfig(emulator.executablePath)
      : null);
  const baseConfig =
    knownConfig?.baseConfig ??
    (configPath ? await readConfig(configPath).catch(() => null) : null);
  const ownLayouts = new Map<string, Promise<RetroArchSaveLayout | null>>();
  const ownLayoutFor = (romPath: string) => {
    let layout = ownLayouts.get(romPath);
    if (!layout) {
      layout =
        configPath && baseConfig
          ? configuredSaveLayout(
              romPath,
              platform,
              configPath,
              baseConfig
            ).catch(() => null)
          : Promise.resolve(null);
      ownLayouts.set(romPath, layout);
    }
    return layout;
  };
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
      if (!stat?.isFile() || stat.isSymbolicLink()) continue;
      const otherLayout =
        configPath && baseConfig
          ? await configuredSaveLayout(
              disc.path,
              otherPlatform,
              configPath,
              baseConfig
            ).catch(() => null)
          : null;
      for (const ownDisc of game.discs ?? []) {
        if (retroArchSaveStem(ownDisc.path) !== stem) continue;
        const ownLayout = await ownLayoutFor(ownDisc.path);
        if (
          !ownLayout ||
          !otherLayout ||
          retroArchSaveLocationsOverlap(ownLayout, otherLayout)
        ) {
          conflicts.add(stem);
          break;
        }
      }
    }
  }
  return conflicts;
};

export const getRetroArchGameSaveFileFilter = async (game: Game) => {
  const platform = getCloudSaveRetroArchPlatform(game.shop, game.platform);
  if (!platform) return async (_filePath: string) => false;
  const extensions = new Set(getRetroArchRomExtensions(platform));
  const conflicts = await conflictingRomStems(game);
  const candidates = (game.discs ?? [])
    .map((disc) => disc.path)
    .filter(
      (romPath) =>
        extensions.has(path.extname(romPath).slice(1).toLowerCase()) &&
        !conflicts.has(retroArchSaveStem(romPath))
    );
  return createRetroArchGameSaveFileFilter(candidates, platform);
};

export const isRetroArchGameSaveFile = async (game: Game, filePath: string) =>
  (await getRetroArchGameSaveFileFilter(game))(filePath);

export const locationsForGame = async (game: Game) => {
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
    let layout: RetroArchSaveLayout;
    try {
      layout = await configuredSaveLayout(
        romPath,
        platform,
        configPath,
        baseConfig
      );
    } catch {
      unresolved = true;
      continue;
    }
    const { saveDirectory, stateDirectory } = layout;
    if (!saveDirectory && !stateDirectory) {
      unresolved = true;
      continue;
    }
    if (!saveDirectory || !stateDirectory) unresolved = true;
    const transferPakRom = path.join(
      path.dirname(romPath),
      `${path.basename(romPath)}.gb`
    );
    const transferPakStat =
      platform === "n64"
        ? await fs.lstat(transferPakRom).catch(() => null)
        : null;
    locations.push({
      rawPath: retroArchSaveRawPath(platform, romHash),
      romPath,
      saveDirectory,
      stateDirectory,
      stem: path.parse(romPath).name,
      hasTransferPak: Boolean(
        transferPakStat?.isFile() && !transferPakStat.isSymbolicLink()
      ),
    });
  }
  if (!locations.length && !unresolved) unresolved = true;
  const conflictingStems = await conflictingRomStems(game, {
    configPath,
    baseConfig,
  });
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
    configPath,
  };
};

export const retroArchSaveProvider: EmulatorProvider = {
  async discover({ game, environmentId, variantId }: EmulatorProviderContext) {
    const result: EmulatorProviderDiscovery = {
      files: [],
      coverage: [],
      revision: "retroarch-v2",
    };
    let locations: RomSaveLocation[];
    let unresolved: boolean;
    let platform: string;
    try {
      ({ locations, unresolved, platform } = await locationsForGame(game));
    } catch {
      result.coverage.push(unresolvedCoverage("retroarch-config-unresolved"));
      return result;
    }
    if (unresolved) {
      result.coverage.push(unresolvedCoverage("retroarch-rom-unresolved"));
    }
    const stateMetadata = await retroArchStateMetadataForGame(game);
    const targetsByLocation = await Promise.all(
      locations.map(async (location) => ({
        location,
        ...(await discoverRetroArchTargets(location, platform)),
      }))
    );
    const targetOwners = new Map<string, string>();
    const collidingTargets = new Set<string>();
    for (const { location, targets } of targetsByLocation) {
      for (const { filePath } of targets) {
        const owner = targetOwners.get(filePath);
        if (owner && owner !== location.rawPath) collidingTargets.add(filePath);
        targetOwners.set(filePath, location.rawPath);
      }
    }
    for (const {
      location,
      targets,
      complete: directoriesComplete,
    } of targetsByLocation) {
      let complete = directoriesComplete;
      const acceptedStates = new Set<string>();
      for (const { filePath, directory, relativePath } of targets) {
        if (
          relativePath.endsWith(".png") &&
          !acceptedStates.has(relativePath.slice(0, -".png".length))
        ) {
          complete = false;
          continue;
        }
        if (collidingTargets.has(filePath)) {
          complete = false;
          continue;
        }
        const stat = await fs.lstat(filePath).catch(() => null);
        if (!stat) continue;
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          !(await isSafeRetroArchFileTarget(directory, filePath))
        ) {
          complete = false;
          continue;
        }
        result.files.push({
          variantId,
          ruleId: hash(JSON.stringify(["emulator", location.rawPath])),
          rawPath: location.rawPath,
          absolutePath: filePath,
          relativePath,
          ...(relativePath.startsWith("state.state") && stateMetadata
            ? { stateMetadata }
            : {}),
          localBindings: {
            environmentId,
            rootId: hash(JSON.stringify([environmentId, directory])),
            concreteUserSegment: "__default__",
            concretePath: directory,
          },
          confidence: "exact",
          provenance: ["emulator:retroarch"],
        });
        if (/^state\.state(?:\d+|\.auto)?$/.test(relativePath)) {
          acceptedStates.add(relativePath);
        }
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
    const stateFiles = new Set(
      files
        .filter((file) =>
          /^state\.state(?:\d+|\.auto)?$/.test(file.relativePath)
        )
        .map((file) => `${file.rawPath}:${file.relativePath}`)
    );
    for (const location of locations) {
      for (const file of files) {
        if (file.rawPath !== location.rawPath) continue;
        const target = retroArchTargetForFile(location, file.relativePath);
        if (!target) continue;
        const owner = targetOwners.get(target.filePath);
        if (owner && owner !== location.rawPath) {
          collidingTargets.add(target.filePath);
        }
        targetOwners.set(target.filePath, location.rawPath);
      }
    }
    for (const file of files) {
      const parsed = parseRetroArchSaveRawPath(file.rawPath);
      const location = locationByRawPath.get(file.rawPath);
      const target = location
        ? retroArchTargetForFile(location, file.relativePath)
        : null;
      if (!parsed || !location || !target) continue;
      if (
        file.relativePath.endsWith(".png") &&
        !stateFiles.has(
          `${file.rawPath}:${file.relativePath.slice(0, -".png".length)}`
        )
      ) {
        continue;
      }
      if (collidingTargets.has(target.filePath)) continue;
      if (
        !(await isSafeRetroArchFileTarget(target.directory, target.filePath))
      ) {
        continue;
      }
      rules.set(
        emulatorSaveFileKey(file),
        emulatorRestoreRule(file.rawPath, target.filePath, "file")
      );
    }
    return rules;
  },
};
