import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger";
import { SevenZip } from "../7zip";
import { downloadToFile, removeFileQuietly } from "../download-to-file";
import { gamesSublevel, levelKeys } from "@main/level";
import { WindowManager } from "../window-manager";
import { encodeModsError } from "@shared";
import type { GameShop } from "@types";
import type {
  GameModState,
  InstalledMod,
  ModGameStatus,
  ModLoaderId,
  ModProgressEvent,
} from "../../../types/mods.types";
import { findOrphanedDependencies, resolveInstallPlan } from "./dependencies";
import { findGameBySteamId, findGameByTitle } from "./ecosystem";
import { LOADERS, isSafeRelativePath, toSupportedLoader } from "./loaders";
import { getPackageIndex } from "./package-index";
import {
  gameKey,
  modsBackupsPath,
  modsDownloadsPath,
  modsTempPath,
} from "./paths";
import { ModsError } from "./errors";
import { readState, withGameLock, writeState } from "./state";

const DISABLED_SUFFIX = ".old";

const emit = (event: ModProgressEvent) =>
  WindowManager.mainWindow?.webContents.send("on-mod-progress", event);

const exists = (p: string) =>
  fs.promises.access(p).then(
    () => true,
    () => false
  );

const walk = async (dir: string, base = dir): Promise<string[]> => {
  const out: string[] = [];
  for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.isFile())
      out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
};

const pruneEmptyDirs = async (startDir: string, stopAt: string) => {
  let dir = startDir;
  while (dir.startsWith(stopAt) && dir !== stopAt) {
    try {
      await fs.promises.rmdir(dir); // only succeeds when empty
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
};

const getGameDir = async (shop: GameShop, objectId: string) => {
  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!game?.executablePath) return { game, gameDir: null };
  return { game, gameDir: path.dirname(game.executablePath) };
};

/** Works out community + loader once and remembers it (user can override). */
export const resolveGameSupport = async (
  shop: GameShop,
  objectId: string
): Promise<GameModState> => {
  const state = await readState(shop, objectId);
  if (state.community && state.loader) return state;

  const { game } = await getGameDir(shop, objectId);
  const eco =
    (shop === "steam" ? await findGameBySteamId(objectId) : null) ??
    (game?.title ? await findGameByTitle(game.title) : null);

  if (eco) {
    state.community = state.community ?? eco.identifier;
    state.loader = toSupportedLoader(eco.packageLoader);
    await writeState(shop, objectId, state);
  }
  return state;
};

export const setGameCommunity = async (
  shop: GameShop,
  objectId: string,
  community: string,
  loader?: ModLoaderId
) =>
  withGameLock(shop, objectId, async () => {
    const state = await readState(shop, objectId);
    state.community = community;
    state.loader = loader ?? "bepinex";
    await writeState(shop, objectId, state);
  });

export const getGameStatus = async (
  shop: GameShop,
  objectId: string
): Promise<ModGameStatus> => {
  const { gameDir } = await getGameDir(shop, objectId);
  const state = await resolveGameSupport(shop, objectId);
  return {
    community: state.community,
    loader: state.loader,
    gameDir,
    installed: Object.values(state.installed),
  };
};

const backupPathFor = (
  shop: string,
  objectId: string,
  fullName: string,
  rel: string
) =>
  path.join(
    modsBackupsPath,
    gameKey(shop, objectId),
    fullName,
    ...rel.split("/")
  );

const removeInstalledFiles = async (gameDir: string, mod: InstalledMod) => {
  for (const rel of mod.files) {
    const target = path.join(gameDir, ...rel.split("/"));
    await removeFileQuietly(target);
    await removeFileQuietly(target + DISABLED_SUFFIX);
    await pruneEmptyDirs(path.dirname(target), gameDir);

    const backup = mod.backups[rel];
    if (backup && (await exists(backup))) {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.copyFile(backup, target);
      await removeFileQuietly(backup);
    }
  }
};

const installOne = async (
  shop: GameShop,
  objectId: string,
  gameDir: string,
  state: GameModState,
  step: {
    fullName: string;
    version: string;
    downloadUrl: string;
    isDependency: boolean;
  },
  progress: (percent: number, stage: ModProgressEvent["stage"]) => void
) => {
  const loader = LOADERS[state.loader!];
  const name = step.fullName.slice(step.fullName.indexOf("-") + 1);
  const isLoaderPkg = loader.isLoaderPackage(name);

  const zipPath = path.join(
    modsDownloadsPath,
    `${step.fullName}-${step.version}.zip`
  );
  const tempDir = path.join(
    modsTempPath,
    `${gameKey(shop, objectId)}-${step.fullName}-${Date.now()}`
  );

  try {
    if (!(await exists(zipPath))) {
      await downloadToFile(step.downloadUrl, zipPath, (loaded, total) =>
        progress(total ? Math.round((loaded / total) * 60) : 30, "downloading")
      );
    }

    progress(65, "extracting");
    await fs.promises.mkdir(tempDir, { recursive: true });
    const result = await SevenZip.extractFile({
      filePath: zipPath,
      outputPath: tempDir,
    });
    if (!result.success)
      throw new ModsError("extract_failed", { name: step.fullName });

    const files = await walk(tempDir);
    const moves = isLoaderPkg
      ? loader.planLoader(files)
      : loader.planMod(files, step.fullName);

    const unsafe = moves.find((m) => !isSafeRelativePath(m.to));
    if (unsafe) throw new ModsError("unsafe_path", { path: unsafe.to });

    // Upgrade/reinstall: remove the previous version cleanly first.
    const previous = state.installed[step.fullName];
    if (previous) {
      await removeInstalledFiles(gameDir, previous);
      delete state.installed[step.fullName];
    }

    progress(80, "installing");
    const owned = new Set(
      Object.values(state.installed).flatMap((m) => m.files)
    );
    const installedFiles: string[] = [];
    const backups: Record<string, string> = {};

    for (const move of moves) {
      const dest = path.join(gameDir, ...move.to.split("/"));
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });

      // Preserve any pre-existing file we don't own so uninstall can restore it.
      if ((await exists(dest)) && !owned.has(move.to)) {
        const backup = backupPathFor(shop, objectId, step.fullName, move.to);
        await fs.promises.mkdir(path.dirname(backup), { recursive: true });
        await fs.promises.copyFile(dest, backup);
        backups[move.to] = backup;
      }

      await fs.promises.copyFile(
        path.join(tempDir, ...move.from.split("/")),
        dest
      );
      installedFiles.push(move.to);
    }

    state.installed[step.fullName] = {
      fullName: step.fullName,
      version: step.version,
      files: installedFiles,
      backups,
      enabled: true,
      isDependency: previous
        ? previous.isDependency && step.isDependency
        : step.isDependency,
      installedAt: new Date().toISOString(),
    };
  } finally {
    await fs.promises
      .rm(tempDir, { recursive: true, force: true })
      .catch(() => {});
  }
};

export const installMod = (
  shop: GameShop,
  objectId: string,
  fullName: string,
  version?: string
) =>
  withGameLock(shop, objectId, async () => {
    const report = (
      stage: ModProgressEvent["stage"],
      percent: number,
      message?: string,
      name = fullName
    ) => emit({ shop, objectId, fullName: name, stage, percent, message });

    try {
      report("resolving", 0);
      const { gameDir } = await getGameDir(shop, objectId);
      if (!gameDir) throw new ModsError("no_executable");

      const state = await resolveGameSupport(shop, objectId);
      if (!state.community) throw new ModsError("no_community");
      if (!state.loader) throw new ModsError("unsupported_loader");

      const { map } = await getPackageIndex(state.community);
      const { plan, missing } = resolveInstallPlan(
        fullName,
        map,
        state.installed,
        version
      );
      if (!plan.some((p) => p.fullName === fullName)) {
        throw new ModsError("package_not_found", { name: fullName });
      }
      if (missing.length)
        logger.warn("Missing Thunderstore dependencies", missing);

      for (let i = 0; i < plan.length; i++) {
        const step = plan[i];
        const base = (i / plan.length) * 100;
        const span = 100 / plan.length;
        await installOne(shop, objectId, gameDir, state, step, (p, stage) =>
          report(
            stage,
            Math.round(base + (p / 100) * span),
            undefined,
            step.fullName
          )
        );
        await writeState(shop, objectId, state); // persist after each package
      }

      report(
        "done",
        100,
        missing.length
          ? encodeModsError("missing_dependencies", {
              list: missing.join(", "),
            })
          : undefined
      );
      return { installed: plan.map((p) => p.fullName), missing };
    } catch (error) {
      logger.error(`Mod install failed: ${fullName}`, error);
      report(
        "error",
        0,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  });

export const uninstallMod = (
  shop: GameShop,
  objectId: string,
  fullName: string,
  removeOrphans = true
) =>
  withGameLock(shop, objectId, async () => {
    const { gameDir } = await getGameDir(shop, objectId);
    if (!gameDir) throw new ModsError("no_game_dir");

    const state = await readState(shop, objectId);
    const mod = state.installed[fullName];
    if (!mod) return { removed: [] as string[] };

    const removed = [fullName];
    await removeInstalledFiles(gameDir, mod);
    delete state.installed[fullName];

    if (removeOrphans && state.community) {
      try {
        const { map } = await getPackageIndex(state.community);
        const versions = Object.fromEntries(
          Object.values(state.installed).map((m) => [m.fullName, m.version])
        );
        for (const orphan of findOrphanedDependencies(
          state.installed,
          map,
          versions
        )) {
          await removeInstalledFiles(gameDir, state.installed[orphan]);
          delete state.installed[orphan];
          removed.push(orphan);
        }
      } catch (error) {
        logger.warn("Orphan cleanup skipped", error);
      }
    }

    await writeState(shop, objectId, state);
    return { removed };
  });

export const setModEnabled = (
  shop: GameShop,
  objectId: string,
  fullName: string,
  enabled: boolean
) =>
  withGameLock(shop, objectId, async () => {
    const { gameDir } = await getGameDir(shop, objectId);
    if (!gameDir) throw new ModsError("no_game_dir");

    const state = await readState(shop, objectId);
    const mod = state.installed[fullName];
    if (!mod || mod.enabled === enabled) return;

    const loader = state.loader ? LOADERS[state.loader] : null;
    const name = fullName.slice(fullName.indexOf("-") + 1);
    if (loader?.isLoaderPackage(name)) {
      throw new ModsError("loader_cannot_disable");
    }

    for (const rel of mod.files) {
      if (loader?.keepOnDisable.some((p) => rel.startsWith(p))) continue;
      const live = path.join(gameDir, ...rel.split("/"));
      const [from, to] = enabled
        ? [live + DISABLED_SUFFIX, live]
        : [live, live + DISABLED_SUFFIX];
      if (await exists(from)) await fs.promises.rename(from, to);
    }

    mod.enabled = enabled;
    await writeState(shop, objectId, state);
  });
