import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { gamesSublevel } from "@main/level";
import { logger } from "@main/services/logger";
import { SystemPath } from "@main/services/system-path";
import type { CloudSaveSyncAnchor, Game, UserLocationCoverage } from "@types";
import {
  getCloudSaveRetroArchPlatform,
  getRetroArchRomExtensions,
} from "@shared";

import { getRetroArchConfig } from "../retroarch/retroarch-repository";
import { hashRomFile } from "../retroarch/rom-hash";
import {
  PLATFORM_TO_CORE,
  RETROARCH_CORES,
} from "../retroarch/retroarch-cores";
import { findRetroArchConfig } from "../emulators/emulator-souvenir-config";
import {
  emulatorSaveFileKey,
  emulatorRestoreRule,
  parseRetroArchSaveRawPath,
  parseRetroArchGameRawPath,
  retroArchGameRawPath,
  retroArchStateRelativePath,
} from "./emulator-provider-identity";
import {
  parseRetroArchSaveConfig,
  createRetroArchGameSaveFileFilter,
  resolveRetroArchConfiguredPath,
  resolveRetroArchOverrideDirectory,
  resolveRetroArchSaveDirectory,
  retroArchSaveStem,
  retroArchBatterySuffixes,
  RETROARCH_LEGACY_EXTRA_SUFFIXES,
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
import {
  remoteRetroArchStateId,
  legacyRetroArchStateId,
  loadRetroArchBindings,
  reconcileRetroArchStateBindings,
  saveRetroArchBindings,
  type RetroArchObservedState,
} from "./retroarch-state-bindings";
import {
  copyRetroArchFileVerified as copyVerified,
  moveRetroArchFileVerified as copyThenRemove,
  hashRetroArchFile as hashFile,
  replaceRetroArchBatteryFilesSafely,
} from "./retroarch-safe-move";
import { dedupeRetroArchBatteryCandidates } from "./retroarch-battery-policy";
import { requireRetroArchExecutablePath } from "./retroarch-executable-guard";

const RETROARCH_STATE_SLOT_SEARCH_LIMIT = 100_000;

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
  try {
    const configContents = await fs.readFile(configPath, "utf8");
    parseRetroArchSaveConfig(configContents);
    return JSON.stringify([
      "retroarch-v2",
      platform,
      core,
      path.resolve(configPath),
      hash(configContents),
    ]);
  } catch {
    return "retroarch-save-config-unresolved";
  }
};

export const getSelectedRetroArchRom = async (game: Game) => {
  const platform = getCloudSaveRetroArchPlatform(game.shop, game.platform);
  if (!platform) return null;
  const discs = game.discs ?? [];
  const selectedPath =
    game.selectedDiscPath === undefined && discs.length === 1
      ? discs[0].path
      : game.selectedDiscPath;
  if (!selectedPath || !discs.some((disc) => disc.path === selectedPath)) {
    return null;
  }
  if (
    !getRetroArchRomExtensions(platform).includes(
      path.extname(selectedPath).slice(1).toLowerCase()
    )
  )
    return null;
  const stat = await fs.lstat(selectedPath).catch(() => null);
  return stat?.isFile() && !stat.isSymbolicLink() ? selectedPath : null;
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
  const executablePath = requireRetroArchExecutablePath(
    emulator.executablePath
  );
  const configPath = findRetroArchConfig(executablePath);
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
  const activePath = await getSelectedRetroArchRom(game);
  if (!activePath) {
    throw new Error("cloud_save_retroarch_rom_missing");
  }
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
      rawPath: retroArchGameRawPath(platform),
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
  if (!locations.some((location) => location.romPath === activePath)) {
    throw new Error("cloud_save_retroarch_rom_missing");
  }
  const safeLocations = locations.filter(
    (location) => !conflictingStems.has(retroArchSaveStem(location.romPath))
  );
  const activeLocation = safeLocations.find(
    (location) => location.romPath === activePath
  );
  if (!activeLocation) {
    throw new Error("cloud_save_retroarch_rom_missing");
  }
  return {
    locations: safeLocations,
    activeLocation,
    unresolved,
    platform,
    configPath,
  };
};

export const seedRetroArchBindingsFromLegacyAnchor = async (
  game: Game,
  anchor: CloudSaveSyncAnchor | null,
  stateIdByLegacyKey: ReadonlyMap<string, string>
) => {
  if (!anchor || stateIdByLegacyKey.size === 0) return;
  const { locations, platform } = await locationsForGame(game);
  const bindings = await loadRetroArchBindings(game);
  const boundPaths = new Set(
    bindings.states.map((state) => path.resolve(state.path))
  );
  let changed = false;
  for (const location of locations) {
    const romHash = await hashRomFile(location.romPath, platform);
    if (!romHash) continue;
    for (const entry of anchor.entries) {
      const oldPath = parseRetroArchSaveRawPath(entry.rawPath);
      if (
        oldPath?.platform !== platform ||
        oldPath.romHash !== romHash ||
        !/^state\.state(?:\d+|\.auto)?$/.test(entry.relativePath)
      )
        continue;
      const target = retroArchTargetForFile(location, entry.relativePath);
      if (
        !target ||
        boundPaths.has(path.resolve(target.filePath)) ||
        !(await isSafeRetroArchFileTarget(target.directory, target.filePath))
      )
        continue;
      const stat = await fs.lstat(target.filePath).catch(() => null);
      if (!stat?.isFile() || stat.isSymbolicLink()) continue;
      const id =
        stateIdByLegacyKey.get(emulatorSaveFileKey(entry)) ??
        legacyRetroArchStateId(game, entry);
      bindings.states.push({
        id,
        path: path.resolve(target.filePath),
        slot: entry.relativePath.slice("state".length),
        hash: await hashFile(target.filePath),
      });
      boundPaths.add(path.resolve(target.filePath));
      changed = true;
    }
  }
  if (changed) await saveRetroArchBindings(game, bindings);
};

export const retroArchSaveProvider: EmulatorProvider = {
  async discover({
    game,
    environmentId,
    variantId,
    remoteFiles = [],
  }: EmulatorProviderContext) {
    const result: EmulatorProviderDiscovery = {
      files: [],
      coverage: [],
      revision: "retroarch-v2",
    };
    let locations: RomSaveLocation[];
    let activeLocation: RomSaveLocation;
    let unresolved: boolean;
    let platform: string;
    try {
      ({ locations, activeLocation, unresolved, platform } =
        await locationsForGame(game));
    } catch {
      result.coverage.push(unresolvedCoverage("retroarch-rom-unresolved"));
      return result;
    }
    const stateMetadata = await retroArchStateMetadataForGame(game);
    const targetsByLocation = await Promise.all(
      [
        activeLocation,
        ...locations.filter(
          (location) => location.romPath !== activeLocation.romPath
        ),
      ].map(async (location) => ({
        location,
        ...(await discoverRetroArchTargets(location, platform)),
      }))
    );
    const seenPhysicalTargets = new Set<string>();
    let complete =
      !unresolved && targetsByLocation.every((item) => item.complete);
    const accepted: Array<{
      location: RomSaveLocation;
      filePath: string;
      directory: string;
      relativePath: string;
      hash: string;
    }> = [];
    const observedStates: RetroArchObservedState[] = [];
    for (const { location, targets } of targetsByLocation) {
      for (const { filePath, directory, relativePath } of targets) {
        if (seenPhysicalTargets.has(filePath)) continue;
        seenPhysicalTargets.add(filePath);
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
        const fileHash = await hashFile(filePath);
        accepted.push({
          location,
          filePath,
          directory,
          relativePath,
          hash: fileHash,
        });
        const state = /^state(\.state(?:\d+|\.auto)?)$/.exec(relativePath);
        if (state) {
          observedStates.push({
            path: filePath,
            slot: state[1],
            hash: fileHash,
            romPath: location.romPath,
          });
        }
      }
    }
    const bindings = reconcileRetroArchStateBindings(
      game,
      await loadRetroArchBindings(game),
      observedStates,
      remoteFiles
    );
    await saveRetroArchBindings(game, {
      ...bindings,
      activeRomPath: activeLocation.romPath,
    });
    const bindingByPath = new Map(
      bindings.states.map((binding) => [binding.path, binding])
    );
    const seenFiles = new Map<string, string>();
    for (const item of accepted) {
      const { location, filePath, directory, hash: fileHash } = item;
      let relativePath = item.relativePath;
      const state = /^state(\.state(?:\d+|\.auto)?)$/.exec(relativePath);
      if (state) {
        const binding = bindingByPath.get(path.resolve(filePath));
        if (!binding) {
          complete = false;
          continue;
        }
        relativePath = retroArchStateRelativePath(binding.id);
      } else if (/^state\.state(?:\d+|\.auto)?\.png$/.test(relativePath)) {
        const binding = bindingByPath.get(
          path.resolve(filePath.slice(0, -".png".length))
        );
        if (!binding) {
          complete = false;
          continue;
        }
        relativePath = retroArchStateRelativePath(binding.id, true);
      }
      const identity = `${location.rawPath}:${relativePath}`;
      const previousHash = seenFiles.get(identity);
      if (previousHash) {
        if (previousHash !== fileHash) complete = false;
        continue;
      }
      seenFiles.set(identity, fileHash);
      result.files.push({
        variantId,
        ruleId: hash(JSON.stringify(["emulator", location.rawPath])),
        rawPath: location.rawPath,
        absolutePath: filePath,
        relativePath,
        ...(state && stateMetadata ? { stateMetadata } : {}),
        localBindings: {
          environmentId,
          rootId: hash(JSON.stringify([environmentId, directory])),
          concreteUserSegment: "__default__",
          concretePath: directory,
        },
        confidence: "exact",
        provenance: ["emulator:retroarch"],
      });
    }
    result.coverage.push(
      coverage(retroArchGameRawPath(platform), variantId, complete)
    );
    return result;
  },
  async restoreRules(game: Game, files) {
    let activeLocation: RomSaveLocation;
    try {
      ({ activeLocation } = await locationsForGame(game));
    } catch {
      return new Map();
    }
    const rules = new Map<string, ReturnType<typeof emulatorRestoreRule>>();
    const bindings = await loadRetroArchBindings(game);
    const stateDirectory = activeLocation.stateDirectory;
    const usedSlots = new Set<string>();
    if (stateDirectory) {
      for (const name of await fs.readdir(stateDirectory).catch(() => [])) {
        const stateName = name.endsWith(".png") ? name.slice(0, -4) : name;
        if (!stateName.startsWith(activeLocation.stem)) continue;
        const suffix = stateName.slice(activeLocation.stem.length);
        if (/^\.state(?:\d+|\.auto)?$/.test(suffix)) {
          usedSlots.add(suffix);
        }
      }
    }
    for (const binding of bindings.states) {
      if (
        stateDirectory &&
        path.dirname(binding.path) === stateDirectory &&
        path.basename(binding.path) === `${activeLocation.stem}${binding.slot}`
      ) {
        usedSlots.add(binding.slot);
      }
    }
    const stateTargets = new Map<string, string>();
    const stateFilesById = new Map(
      files
        .filter((file) => !file.relativePath.endsWith(".png"))
        .map((file) => [remoteRetroArchStateId(game, file), file] as const)
        .filter((entry): entry is [string, (typeof files)[number]] =>
          Boolean(entry[0])
        )
    );
    const nextFreeSlot = () => {
      for (
        let number = 0;
        number < RETROARCH_STATE_SLOT_SEARCH_LIMIT;
        number += 1
      ) {
        const slot = number === 0 ? ".state" : `.state${number}`;
        if (!usedSlots.has(slot)) {
          usedSlots.add(slot);
          return slot;
        }
      }
      throw new Error("cloud_save_retroarch_state_slots_exhausted");
    };
    for (const [id, file] of stateFilesById) {
      if (!stateDirectory) continue;
      const known = bindings.states.find((item) => item.id === id);
      const currentTarget =
        known &&
        path.dirname(known.path) === stateDirectory &&
        path.basename(known.path) === `${activeLocation.stem}${known.slot}`
          ? known.path
          : null;
      const slot = currentTarget
        ? known!.slot
        : known &&
            /^\.state(?:\d+|\.auto)?$/.test(known.slot) &&
            !usedSlots.has(known.slot)
          ? known.slot
          : nextFreeSlot();
      usedSlots.add(slot);
      const target =
        currentTarget ??
        path.join(stateDirectory, `${activeLocation.stem}${slot}`);
      stateTargets.set(id, target);
      if (!currentTarget) {
        bindings.states.push({
          id,
          path: target,
          slot,
          hash: file.hash,
        });
      }
    }
    await saveRetroArchBindings(game, bindings);
    for (const file of files) {
      if (
        !parseRetroArchGameRawPath(file.rawPath) &&
        !parseRetroArchSaveRawPath(file.rawPath)
      )
        continue;
      const id = remoteRetroArchStateId(game, file);
      const target = id
        ? stateTargets.has(id) && stateDirectory
          ? {
              directory: stateDirectory,
              filePath:
                stateTargets.get(id)! +
                (file.relativePath.endsWith(".png") ? ".png" : ""),
            }
          : null
        : retroArchTargetForFile(activeLocation, file.relativePath);
      if (!target) continue;
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

const retroArchSaveHistoryRoot = (game: Game) => {
  const userData = SystemPath.getPath("userData");
  if (!path.isAbsolute(userData)) {
    throw new Error("cloud_save_retroarch_archive_unavailable");
  }
  return path.join(
    userData,
    "retroarch-save-history",
    hash(JSON.stringify([game.shop, game.objectId]))
  );
};

const archiveDuplicate = async (game: Game, filePath: string) => {
  const root = retroArchSaveHistoryRoot(game);
  await copyThenRemove(
    filePath,
    path.join(root, `${randomUUID()}-${path.basename(filePath)}`)
  );
};

export const listRetroArchLocalBatteryCandidates = async (game: Game) => {
  const { locations, activeLocation, platform } = await locationsForGame(game);
  const auxiliaryNames = [
    ...retroArchBatterySuffixes(platform).map((suffix) => `battery${suffix}`),
    ...RETROARCH_LEGACY_EXTRA_SUFFIXES.map((suffix) => `battery${suffix}`),
    "transfer-pak.sav",
  ];
  const candidates = await Promise.all(
    [
      activeLocation,
      ...locations.filter((item) => item.romPath !== activeLocation.romPath),
    ].map(async (location) => {
      const files = (
        await Promise.all(
          auxiliaryNames.map(async (relativePath) => {
            const target = retroArchTargetForFile(location, relativePath);
            const stat = target
              ? await fs.lstat(target.filePath).catch(() => null)
              : null;
            return target &&
              stat?.isFile() &&
              !stat.isSymbolicLink() &&
              (await isSafeRetroArchFileTarget(
                target.directory,
                target.filePath
              ))
              ? {
                  relativePath,
                  path: target.filePath,
                  hash: await hashFile(target.filePath),
                  lastModifiedAt: stat.mtime.toISOString(),
                }
              : null;
          })
        )
      ).filter((file): file is NonNullable<typeof file> => file !== null);
      return files.length
        ? {
            romPath: location.romPath,
            files,
            signature: hash(
              JSON.stringify(
                files.map((file) => [file.relativePath, file.hash]).sort()
              )
            ),
          }
        : null;
    })
  );
  const present = candidates.filter(
    (candidate): candidate is NonNullable<typeof candidate> =>
      candidate !== null
  );
  const bindings = await loadRetroArchBindings(game);
  const stored = await Promise.all(
    (bindings.batterySources ?? []).map(async (candidate) => {
      const files = (
        await Promise.all(
          candidate.files.map(async (file) => {
            const stat = await fs.lstat(file.path).catch(() => null);
            if (
              !stat?.isFile() ||
              stat.isSymbolicLink() ||
              !(await isSafeRetroArchFileTarget(
                path.dirname(file.path),
                file.path
              ))
            ) {
              return null;
            }
            const currentHash = await hashFile(file.path);
            if (currentHash !== file.hash) return null;
            return {
              ...file,
              hash: currentHash,
              lastModifiedAt: stat.mtime.toISOString(),
            };
          })
        )
      ).filter((file): file is NonNullable<typeof file> => file !== null);
      return files.length
        ? {
            romPath: candidate.romPath,
            files,
            signature: hash(
              JSON.stringify(
                files.map((file) => [file.relativePath, file.hash]).sort()
              )
            ),
          }
        : null;
    })
  );
  return dedupeRetroArchBatteryCandidates([
    ...present,
    ...stored.filter((item): item is NonNullable<typeof item> => item !== null),
  ]);
};

export const captureRetroArchSavesBeforeRomChange = async (game: Game) => {
  await retroArchSaveProvider.discover({
    game,
    environmentId: "retroarch-rom-change",
    variantId: hash(JSON.stringify([game.shop, game.objectId])),
  });
  const batterySources = await listRetroArchLocalBatteryCandidates(game);
  const bindings = await loadRetroArchBindings(game);
  await saveRetroArchBindings(game, { ...bindings, batterySources });
};

export const selectRetroArchLocalBattery = async (
  game: Game,
  romPath: string,
  signature: string
) => {
  const candidates = await listRetroArchLocalBatteryCandidates(game);
  if (
    !candidates.some(
      (candidate) =>
        candidate.romPath === romPath && candidate.signature === signature
    )
  ) {
    throw new Error("cloud_save_retroarch_battery_selection_stale");
  }
  const bindings = await loadRetroArchBindings(game);
  await saveRetroArchBindings(game, {
    ...bindings,
    selectedBatterySignature: signature,
  });
};

export const materializeRetroArchLocalSaves = async (game: Game) => {
  const { activeLocation } = await locationsForGame(game);
  const batteryCandidates = await listRetroArchLocalBatteryCandidates(game);
  const bindingsBefore = await loadRetroArchBindings(game);
  const batterySignatures = new Set(
    batteryCandidates.map((item) => item.signature)
  );
  if (
    batterySignatures.size > 1 &&
    !batteryCandidates.some(
      (item) => item.signature === bindingsBefore.selectedBatterySignature
    )
  ) {
    throw new Error("cloud_save_retroarch_battery_local_conflict");
  }
  await retroArchSaveProvider.discover({
    game,
    environmentId: "retroarch-materialize",
    variantId: hash(JSON.stringify([game.shop, game.objectId])),
  });
  const bindings = await loadRetroArchBindings(game);
  const stateDirectory = activeLocation.stateDirectory;
  if (!stateDirectory) {
    throw new Error("cloud_save_retroarch_config_unresolved");
  }
  const activeStatePaths = new Set<string>();
  for (const entry of await fs.readdir(stateDirectory).catch(() => [])) {
    const stateName = entry.endsWith(".png") ? entry.slice(0, -4) : entry;
    activeStatePaths.add(path.join(stateDirectory, stateName));
  }
  for (const binding of bindings.states) {
    if (
      path.dirname(binding.path) === stateDirectory &&
      path.basename(binding.path) === `${activeLocation.stem}${binding.slot}`
    ) {
      activeStatePaths.add(binding.path);
    }
  }
  for (const binding of bindings.states) {
    const source = binding.path;
    const sourceStat = await fs.lstat(source).catch(() => null);
    if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) continue;
    if (
      path.dirname(source) === stateDirectory &&
      path.basename(source) === `${activeLocation.stem}${binding.slot}`
    )
      continue;
    const existingActive = bindings.states.find(
      (other) =>
        other !== binding &&
        other.id === binding.id &&
        activeStatePaths.has(other.path)
    );
    const existingActiveStat = existingActive
      ? await fs.lstat(existingActive.path).catch(() => null)
      : null;
    if (
      existingActive &&
      existingActiveStat?.isFile() &&
      !existingActiveStat.isSymbolicLink() &&
      (await hashFile(existingActive.path)) === (await hashFile(source))
    ) {
      const sourceImage = `${source}.png`;
      const sourceImageStat = await fs.lstat(sourceImage).catch(() => null);
      if (sourceImageStat?.isFile() && !sourceImageStat.isSymbolicLink()) {
        const activeImage = `${existingActive.path}.png`;
        const activeImageStat = await fs.lstat(activeImage).catch(() => null);
        if (
          activeImageStat &&
          (!activeImageStat.isFile() || activeImageStat.isSymbolicLink())
        ) {
          throw new Error("cloud_save_retroarch_unsafe_image");
        }
        if (!activeImageStat) await copyVerified(sourceImage, activeImage);
      }
      await archiveDuplicate(game, source);
      if (sourceImageStat) {
        await archiveDuplicate(game, sourceImage);
      }
      binding.path = existingActive.path;
      binding.slot = existingActive.slot;
      continue;
    }
    let slot = binding.slot;
    let target = path.join(stateDirectory, `${activeLocation.stem}${slot}`);
    if (
      activeStatePaths.has(target) ||
      (await fs.lstat(target).catch(() => null)) ||
      (await fs.lstat(`${target}.png`).catch(() => null))
    ) {
      let found = false;
      for (
        let index = 0;
        index < RETROARCH_STATE_SLOT_SEARCH_LIMIT;
        index += 1
      ) {
        slot = index === 0 ? ".state" : `.state${index}`;
        target = path.join(stateDirectory, `${activeLocation.stem}${slot}`);
        if (
          !activeStatePaths.has(target) &&
          !(await fs.lstat(target).catch(() => null)) &&
          !(await fs.lstat(`${target}.png`).catch(() => null))
        ) {
          found = true;
          break;
        }
      }
      if (!found) throw new Error("cloud_save_retroarch_state_slots_exhausted");
    }
    const sourceImage = `${source}.png`;
    const imageStat = await fs.lstat(sourceImage).catch(() => null);
    if (imageStat && (!imageStat.isFile() || imageStat.isSymbolicLink())) {
      throw new Error("cloud_save_retroarch_unsafe_image");
    }
    const imageExists = Boolean(imageStat);
    if (!(await isSafeRetroArchFileTarget(stateDirectory, target))) {
      throw new Error("cloud_save_retroarch_target_occupied");
    }
    if (imageExists) {
      const imageTarget = `${target}.png`;
      await copyVerified(sourceImage, imageTarget);
    }
    await copyThenRemove(source, target);
    if (imageExists) {
      if ((await hashFile(sourceImage)) !== (await hashFile(`${target}.png`))) {
        throw new Error("cloud_save_retroarch_source_changed");
      }
      await fs.unlink(sourceImage);
    }
    binding.path = target;
    binding.slot = slot;
    activeStatePaths.add(target);
  }
  const commitBindings = () =>
    saveRetroArchBindings(game, {
      ...bindings,
      activeRomPath: activeLocation.romPath,
      selectedBatterySignature: undefined,
      batterySources: batteryCandidates,
      states: bindings.states.filter(
        (item, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.id === item.id && candidate.path === item.path
          ) === index
      ),
    });
  if (batteryCandidates.length > 0) {
    const winner =
      batteryCandidates.find(
        (item) => item.signature === bindingsBefore.selectedBatterySignature
      ) ??
      batteryCandidates.find(
        (item) => item.romPath === activeLocation.romPath
      ) ??
      batteryCandidates[0];
    const winnerPaths = new Set(winner.files.map((file) => file.path));
    const archiveFiles: Array<{ path: string; hash: string }> = [];
    const activePathsToClear = new Set<string>();
    for (const candidate of batteryCandidates) {
      if (candidate === winner) continue;
      for (const file of candidate.files) {
        if (winnerPaths.has(file.path)) continue;
        const activeTarget = retroArchTargetForFile(
          activeLocation,
          file.relativePath
        );
        if (!activeTarget) continue;
        archiveFiles.push({ path: file.path, hash: file.hash });
        if (file.path === activeTarget.filePath)
          activePathsToClear.add(file.path);
      }
    }
    const replacements: Array<{
      source: string;
      target: string;
      hash: string;
    }> = [];
    for (const file of winner.files) {
      const activeTarget = retroArchTargetForFile(
        activeLocation,
        file.relativePath
      );
      if (!activeTarget) continue;
      if (
        !(await isSafeRetroArchFileTarget(
          activeTarget.directory,
          activeTarget.filePath
        ))
      ) {
        throw new Error("cloud_save_retroarch_target_occupied");
      }
      replacements.push({
        source: file.path,
        target: activeTarget.filePath,
        hash: file.hash,
      });
    }
    const { cleanupFailures } = await replaceRetroArchBatteryFilesSafely({
      replacements,
      archiveFiles,
      activePathsToClear: [...activePathsToClear],
      archiveRoot: retroArchSaveHistoryRoot(game),
      commit: commitBindings,
    });
    if (cleanupFailures.length) {
      logger.warn(
        "[Cloud Save] RetroArch battery installed with pending cleanup",
        cleanupFailures
      );
    }
  } else {
    await commitBindings();
  }
};
