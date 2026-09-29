import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  Game,
  LocalGameSnapshotContext,
  ResolvedRestoreTarget,
} from "@types";

import { cloudSaveFileKey } from "./cloud-save-contract.js";
import { emulatorDestinationKindForFile } from "./emulator-destination-policy.js";
import { parseRetroArchSaveRawPath } from "./emulator-provider-identity.js";
import { getEmulatorSaveProvider } from "./emulator-save-provider.js";
import { retroArchTargetForFile } from "./retroarch-save-scanner.js";
import {
  parseRpcs3ActiveProfileId,
  resolveRpcs3VfsHdd0,
} from "./rpcs3-save-layout.js";

type RootLayout = {
  rawPathPrefix: string;
  profileNames: ReadonlySet<string>;
  branches: ReadonlySet<string>;
  configPaths: readonly string[][];
  allowSiblingProof: boolean;
  matchesSuffix: (suffix: string[], rawPath: string) => boolean;
};

const layouts: RootLayout[] = [
  {
    rawPathPrefix: "<emulator>/retroarch/",
    profileNames: new Set(["retroarch"]),
    branches: new Set(["saves", "states"]),
    configPaths: [["retroarch.cfg"], ["config", "retroarch.cfg"]],
    allowSiblingProof: true,
    matchesSuffix: () => true,
  },
  {
    rawPathPrefix: "<emulator>/ppsspp/",
    profileNames: new Set(["psp"]),
    branches: new Set(["savedata", "ppsspp_state"]),
    configPaths: [["SYSTEM", "ppsspp.ini"]],
    allowSiblingProof: true,
    matchesSuffix: (suffix) => suffix.length === 0,
  },
  {
    rawPathPrefix: "<emulator>/rpcs3-state/",
    profileNames: new Set(["rpcs3"]),
    branches: new Set(["savestates"]),
    configPaths: [
      ["GuiConfigs", "persistent_settings.dat"],
      ["vfs.yml"],
      ["config.yml"],
    ],
    allowSiblingProof: false,
    matchesSuffix: (suffix, rawPath) =>
      suffix.length === 1 &&
      /^<emulator>\/rpcs3-state\/[A-Z]{4}\d{5}$/.test(rawPath) &&
      suffix[0].toUpperCase() === rawPath.slice(-9),
  },
  {
    rawPathPrefix: "<emulator>/rpcs3/",
    profileNames: new Set(["rpcs3"]),
    branches: new Set(["dev_hdd0"]),
    configPaths: [
      ["GuiConfigs", "persistent_settings.dat"],
      ["vfs.yml"],
      ["config.yml"],
    ],
    allowSiblingProof: false,
    matchesSuffix: (suffix, rawPath) => {
      const parsed = /^<emulator>\/rpcs3\/([A-Z]{4}\d{5})\/(\d{8})$/.exec(
        rawPath
      );
      return (
        !!parsed &&
        suffix.length === 3 &&
        suffix[0] === "home" &&
        /^\d{8}$/.test(suffix[1]) &&
        suffix[2] === "savedata"
      );
    },
  },
  {
    rawPathPrefix: "<emulator>/duckstation-state/",
    profileNames: new Set(["duckstation"]),
    branches: new Set(["savestates"]),
    configPaths: [["settings.ini"]],
    allowSiblingProof: false,
    matchesSuffix: (suffix) => suffix.length === 0,
  },
  {
    rawPathPrefix: "<emulator>/pcsx2-state/",
    profileNames: new Set(["pcsx2"]),
    branches: new Set(["sstates"]),
    configPaths: [["inis", "PCSX2.ini"]],
    allowSiblingProof: false,
    matchesSuffix: (suffix) => suffix.length === 0,
  },
  {
    rawPathPrefix: "<emulator>/dolphin-state/",
    profileNames: new Set([
      "dolphin",
      "dolphin emulator",
      ".dolphin-emu",
      "dolphin-emu",
    ]),
    branches: new Set(["statesaves"]),
    configPaths: [["Config", "Dolphin.ini"]],
    allowSiblingProof: false,
    matchesSuffix: (suffix) => suffix.length === 0,
  },
  {
    rawPathPrefix: "<emulator>/dolphin-gci/",
    profileNames: new Set([
      "dolphin",
      "dolphin emulator",
      ".dolphin-emu",
      "dolphin-emu",
    ]),
    branches: new Set(["gc"]),
    configPaths: [["Config", "Dolphin.ini"]],
    allowSiblingProof: false,
    matchesSuffix: (suffix, rawPath) => {
      const parsed = /^<emulator>\/dolphin-gci\/([AB])\/([A-Z0-9]{6})$/.exec(
        rawPath
      );
      if (!parsed || suffix.length !== 2) return false;
      const regionCode = parsed[2][3];
      const region =
        regionCode === "E" || regionCode === "N"
          ? "usa"
          : regionCode === "J"
            ? "jap"
            : "PDFHIXSUY".includes(regionCode)
              ? "eur"
              : null;
      return (
        region !== null &&
        suffix[0] === region &&
        suffix[1] === `card ${parsed[1].toLowerCase()}`
      );
    },
  },
  {
    rawPathPrefix: "<emulator>/dolphin-wii/",
    profileNames: new Set([
      "dolphin",
      "dolphin emulator",
      ".dolphin-emu",
      "dolphin-emu",
    ]),
    branches: new Set(["wii"]),
    configPaths: [["Config", "Dolphin.ini"]],
    allowSiblingProof: false,
    matchesSuffix: (suffix, rawPath) => {
      const parsed = /^<emulator>\/dolphin-wii\/00010000([a-f0-9]{8})$/.exec(
        rawPath
      );
      return (
        !!parsed &&
        suffix.length === 4 &&
        suffix[0] === "title" &&
        suffix[1] === "00010000" &&
        suffix[2] === parsed[1] &&
        suffix[3] === "data"
      );
    },
  },
];

const layoutFor = (rawPath: string) =>
  layouts.find((layout) => rawPath.startsWith(layout.rawPathPrefix)) ?? null;

export const usesFilesystemEmulatorRestoreRoot = (rawPath: string) =>
  layoutFor(rawPath) !== null;

const within = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

const lstat = async (target: string) =>
  fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

type RetroArchConfiguredRoot = {
  directory: string;
  configPath: string;
  targetPath: string;
};
type RetroArchRootResolver = (
  target: ResolvedRestoreTarget
) => Promise<RetroArchConfiguredRoot | null>;
type BoundRootVerifier = (target: ResolvedRestoreTarget) => Promise<boolean>;

const configuredRetroArchRootResolver = (game: Game): RetroArchRootResolver => {
  const loadLocations = () =>
    import("./retroarch-save-provider.js").then(({ locationsForGame }) =>
      locationsForGame(game)
    );
  let locations: ReturnType<typeof loadLocations> | null = null;
  return async (target) => {
    const kind = emulatorDestinationKindForFile(
      target.rawPath,
      target.relativePath
    );
    if (!parseRetroArchSaveRawPath(target.rawPath) || !kind) return null;
    locations ??= loadLocations();
    const configured = await locations.catch(() => null);
    const matching = configured?.locations.filter(
      (location) => location.rawPath === target.rawPath
    );
    if (matching?.length !== 1) return null;
    const physical = retroArchTargetForFile(matching[0], target.relativePath);
    const directory =
      kind === "save" ? matching[0].saveDirectory : matching[0].stateDirectory;
    return physical && directory === physical.directory
      ? {
          directory,
          configPath: configured!.configPath,
          targetPath: physical.filePath,
        }
      : null;
  };
};

/** A configured RetroArch destination may be created only under this home. */
export const isSafeConfiguredRetroArchRestoreRoot = async (
  target: ResolvedRestoreTarget,
  local: LocalGameSnapshotContext,
  configured: RetroArchConfiguredRoot
) => {
  if (
    target.action !== "create" ||
    !parseRetroArchSaveRawPath(target.rawPath) ||
    !emulatorDestinationKindForFile(target.rawPath, target.relativePath)
  ) {
    return false;
  }
  const root = path.resolve(target.restoreRootPath);
  const configPath = path.resolve(configured.configPath);
  if (
    root !== path.resolve(configured.directory) ||
    path.resolve(target.targetPath) !== path.resolve(configured.targetPath) ||
    !within(root, path.resolve(target.targetPath)) ||
    root === path.resolve(target.targetPath)
  ) {
    return false;
  }
  try {
    const home = path.resolve(local.pathContext.homeDir);
    if (!within(home, root) || !within(home, configPath)) return false;
    const homeStat = await fs.lstat(home);
    if (!homeStat.isDirectory() || homeStat.isSymbolicLink()) return false;
    const checkPath = async (candidate: string, expectFile: boolean) => {
      const segments = path.relative(home, candidate).split(path.sep);
      let current = home;
      let missing = false;
      for (const [index, segment] of segments.entries()) {
        current = path.join(current, segment);
        const stat = missing ? null : await lstat(current);
        if (!stat) {
          missing = true;
          if (expectFile) return false;
          continue;
        }
        if (
          stat.isSymbolicLink() ||
          stat.dev !== homeStat.dev ||
          (index === segments.length - 1 && expectFile
            ? !stat.isFile()
            : !stat.isDirectory())
        ) {
          return false;
        }
      }
      return true;
    };
    return (
      (await checkPath(configPath, true)) && (await checkPath(root, false))
    );
  } catch {
    return false;
  }
};

const rootedLayout = (root: string, layout: RootLayout) => {
  let profile = path.resolve(root);
  while (profile !== path.dirname(profile)) {
    if (layout.profileNames.has(path.basename(profile).toLowerCase())) {
      const suffix = path.relative(profile, root).split(path.sep);
      const branchIndex =
        layout.rawPathPrefix === "<emulator>/retroarch/" &&
        suffix[0].toLowerCase() === "config"
          ? 1
          : 0;
      if (
        suffix.length <= branchIndex ||
        !layout.branches.has(suffix[branchIndex].toLowerCase())
      ) {
        return null;
      }
      return {
        profile,
        prefix: suffix
          .slice(0, branchIndex)
          .map((segment) => segment.toLowerCase()),
        branch: suffix[branchIndex].toLowerCase(),
        suffix: suffix
          .slice(branchIndex + 1)
          .map((segment) => segment.toLowerCase()),
      };
    }
    profile = path.dirname(profile);
  }
  return null;
};

const existingPathIsSafe = async (
  profile: string,
  root: string,
  device: number
) => {
  let current = profile;
  for (const segment of path.relative(profile, root).split(path.sep)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (!stat) return true;
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== device) {
      return false;
    }
  }
  return false;
};

const hasLocalProfileConfig = async (
  profile: string,
  canonicalProfile: string,
  device: number,
  layout: RootLayout
) => {
  for (const segments of layout.configPaths) {
    const configPath = path.join(profile, ...segments);
    const stat = await lstat(configPath).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink() || stat.dev !== device) {
      continue;
    }
    const resolved = await fs.realpath(configPath).catch(() => null);
    if (resolved && within(canonicalProfile, resolved)) return true;
  }
  return false;
};

const isDefaultRpcs3SavedataTarget = async (
  profile: string,
  root: string,
  target: ResolvedRestoreTarget,
  device: number
) => {
  const parsed = /^<emulator>\/rpcs3\/([A-Z]{4}\d{5})\/\d{8}$/.exec(
    target.rawPath
  );
  const [slot, child] = target.relativePath.split("/");
  if (!parsed || !slot?.startsWith(parsed[1]) || !child) return false;

  const activeProfileId = path.basename(path.dirname(root));
  const settingsPath = path.join(
    profile,
    "GuiConfigs",
    "persistent_settings.dat"
  );
  const vfsPath = path.join(profile, "vfs.yml");
  const settingsStat = await lstat(settingsPath);
  const vfsStat = await lstat(vfsPath);
  for (const stat of [settingsStat, vfsStat]) {
    if (
      stat &&
      (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== device)
    ) {
      return false;
    }
  }
  const settings = settingsStat
    ? await fs.readFile(settingsPath, "utf8")
    : null;
  if (parseRpcs3ActiveProfileId(settings) !== activeProfileId) return false;
  const vfs = vfsStat ? await fs.readFile(vfsPath, "utf8") : null;
  if (
    path.resolve(resolveRpcs3VfsHdd0(profile, vfs)) !==
    path.join(profile, "dev_hdd0")
  ) {
    return false;
  }
  const [hdd0, activeProfile] = await Promise.all([
    lstat(path.join(profile, "dev_hdd0")),
    lstat(path.dirname(root)),
  ]);
  return [hdd0, activeProfile].every(
    (stat) =>
      stat?.isDirectory() && !stat.isSymbolicLink() && stat.dev === device
  );
};

/**
 * A missing default folder is safe to create when its active config exists in
 * the local emulator profile. RetroArch and PPSSPP may also use a scanned
 * sibling folder as proof. External/custom paths need an explicit binding.
 */
export const isSafeMissingEmulatorRestoreRoot = async (
  target: ResolvedRestoreTarget,
  local: LocalGameSnapshotContext
) => {
  const layout = layoutFor(target.rawPath);
  if (!layout || target.action !== "create") return false;
  const root = path.resolve(target.restoreRootPath);
  const parsed = rootedLayout(root, layout);
  if (!parsed || !layout.matchesSuffix(parsed.suffix, target.rawPath)) {
    return false;
  }

  try {
    if (await lstat(root)) return false;
    const [home, canonicalProfile] = await Promise.all([
      fs.realpath(local.pathContext.homeDir),
      fs.realpath(parsed.profile),
    ]);
    if (!within(home, canonicalProfile)) return false;
    const [homeStat, profileStat] = await Promise.all([
      fs.stat(home),
      lstat(parsed.profile),
    ]);
    if (
      !profileStat?.isDirectory() ||
      profileStat.isSymbolicLink() ||
      homeStat.dev !== profileStat.dev ||
      !(await existingPathIsSafe(parsed.profile, root, profileStat.dev))
    ) {
      return false;
    }

    const hasConfig = await hasLocalProfileConfig(
      parsed.profile,
      canonicalProfile,
      profileStat.dev,
      layout
    );
    if (hasConfig) {
      return layout.rawPathPrefix === "<emulator>/rpcs3/"
        ? isDefaultRpcs3SavedataTarget(
            parsed.profile,
            root,
            target,
            profileStat.dev
          )
        : true;
    }

    if (!layout.allowSiblingProof) return false;
    for (const source of local.sourceFiles) {
      if (
        source.variantId !== target.variantId ||
        !source.rawPath.startsWith(layout.rawPathPrefix)
      ) {
        continue;
      }
      const sourceRoot = path.resolve(source.localBindings.concretePath);
      const sourceLayout = rootedLayout(sourceRoot, layout);
      if (
        sourceLayout?.profile !== parsed.profile ||
        sourceLayout.prefix.join("/") !== parsed.prefix.join("/") ||
        sourceLayout.branch === parsed.branch ||
        sourceLayout.suffix.join("/") !== parsed.suffix.join("/")
      ) {
        continue;
      }
      const [sourceRootStat, sourceFileStat] = await Promise.all([
        lstat(sourceRoot),
        lstat(source.absolutePath),
      ]);
      if (
        sourceRootStat?.isDirectory() &&
        !sourceRootStat.isSymbolicLink() &&
        sourceRootStat.dev === profileStat.dev &&
        sourceFileStat?.isFile() &&
        !sourceFileStat.isSymbolicLink() &&
        within(sourceRoot, path.resolve(source.absolutePath))
      ) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
};

export const safeMissingEmulatorRestoreEntryIds = async (
  targets: ResolvedRestoreTarget[],
  local: LocalGameSnapshotContext,
  game?: Game | null,
  resolveRetroArchRoot?: RetroArchRootResolver
) => {
  const safe = new Set<string>();
  const retroArch = game && getEmulatorSaveProvider(game) === "retroarch";
  const resolveRoot =
    resolveRetroArchRoot ??
    (retroArch ? configuredRetroArchRootResolver(game) : null);
  for (const target of targets) {
    const configured =
      retroArch && parseRetroArchSaveRawPath(target.rawPath)
        ? await resolveRoot?.(target)
        : null;
    if (
      configured
        ? await isSafeConfiguredRetroArchRestoreRoot(target, local, configured)
        : retroArch && parseRetroArchSaveRawPath(target.rawPath)
          ? false
          : await isSafeMissingEmulatorRestoreRoot(target, local)
    ) {
      safe.add(cloudSaveFileKey(target));
    }
  }
  return safe;
};

export const assertFilesystemEmulatorRestoreRoots = async (
  targets: ResolvedRestoreTarget[],
  local: LocalGameSnapshotContext,
  safeMissingAtAnalysis: ReadonlySet<string>,
  game?: Game | null,
  resolveRetroArchRoot?: RetroArchRootResolver,
  verifyBoundRoot?: BoundRootVerifier
) => {
  const retroArch = game && getEmulatorSaveProvider(game) === "retroarch";
  const resolveRoot =
    resolveRetroArchRoot ??
    (retroArch ? configuredRetroArchRootResolver(game) : null);
  for (const target of targets) {
    if (
      target.action === "skip-identical" ||
      !usesFilesystemEmulatorRestoreRoot(target.rawPath)
    ) {
      continue;
    }
    const entryId = cloudSaveFileKey(target);
    if (
      retroArch &&
      parseRetroArchSaveRawPath(target.rawPath) &&
      safeMissingAtAnalysis.has(entryId)
    ) {
      const configured = await resolveRoot?.(target);
      const safeConfigured =
        configured &&
        (await isSafeConfiguredRetroArchRestoreRoot(target, local, configured));
      if (!safeConfigured) {
        const bound = verifyBoundRoot
          ? await verifyBoundRoot(target)
          : await (async () => {
              const kind = emulatorDestinationKindForFile(
                target.rawPath,
                target.relativePath
              );
              if (!game || !kind) return false;
              const { isVerifiedEmulatorDestinationBinding } = await import(
                "./emulator-destination-store.js"
              );
              return isVerifiedEmulatorDestinationBinding(
                game,
                target.rawPath,
                kind,
                target.relativePath,
                target.restoreRootPath
              ).catch(() => false);
            })();
        if (!bound) {
          throw new Error("cloud_save_restore_root_unavailable");
        }
      }
      continue;
    }
    const root = await lstat(target.restoreRootPath).catch(() => undefined);
    if (root?.isDirectory() && !root.isSymbolicLink()) continue;
    const wasLocal = local.files.some(
      (file) => cloudSaveFileKey(file) === entryId
    );
    if (
      root !== null ||
      wasLocal ||
      !safeMissingAtAnalysis.has(entryId) ||
      !(await isSafeMissingEmulatorRestoreRoot(target, local))
    ) {
      throw new Error("cloud_save_restore_root_unavailable");
    }
  }
};
