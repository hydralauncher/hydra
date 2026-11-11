import fs from "node:fs";
import path from "node:path";

import type {
  ClassicsDisc,
  GameShop,
  Ps4PkgAccept,
  Ps4PkgCheck,
  Ps4PkgFailure,
  Ps4PkgJobEvent,
  Ps4PkgJobMode,
  Ps4PkgResult,
} from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { platformToSystem } from "@main/helpers";
import { logger, WindowManager } from "@main/services";
import { normalize } from "@main/services/emulators/sku-normalize";
import {
  assertPs4UpdateFits,
  installPs4Pkg,
  isPs4PkgPath,
  Ps4PkgError,
  readPs4FolderParam,
  readPs4PkgInfo,
  type Ps4PkgInfo,
} from "@main/services/ps4-pkg";
import { getNextClassicsDiscLabel } from "@shared";
import { getRecompilationGameFolder } from "../recompilation/recompilation-rom";
import { registerEvent } from "../register-event";

const FAILURE_REASONS: Record<string, Ps4PkgFailure> = {
  missing_base_game: "no_game_folder",
  other_game: "other_game",
  not_newer: "not_newer",
  no_space: "no_space",
  cancelled: "cancelled",
};

let running: { objectId: string; controller: AbortController } | null = null;

/** "0109" → "01.09". */
const formatVersion = (version: string | null | undefined) => {
  const digits = version?.replace(/\D/g, "");
  if (!digits) return null;
  return digits.length > 2
    ? `${digits.slice(0, -2)}.${digits.slice(-2)}`
    : digits;
};

const toGameFolder = (filePath: string) =>
  path.basename(filePath).toLowerCase() === "eboot.bin"
    ? path.dirname(filePath)
    : filePath;

const isGameFolder = (directory: string) =>
  fs.existsSync(path.join(directory, "eboot.bin")) &&
  fs.existsSync(path.join(directory, "sce_sys", "param.sfo"));

const samePath = (a: string, b: string) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

const getPs4Game = async (shop: GameShop, objectId: string) => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  return game && platformToSystem(game.platform) === "ps4" ? game : null;
};

/** The extracted game folders linked to a PS4 game: shadPS4 discs and ports. */
const getGameFolders = async (shop: GameShop, objectId: string) => {
  const game = await getPs4Game(shop, objectId);
  if (!game) return [];

  const folders = new Map<string, string>();
  for (const disc of game.discs ?? []) {
    const folder = disc.recompilationSlug
      ? await getRecompilationGameFolder(objectId, disc.recompilationSlug)
      : toGameFolder(disc.path);
    if (!folder || !isGameFolder(folder)) continue;
    const key = path.resolve(folder).toLowerCase();
    if (!folders.has(key)) folders.set(key, folder);
  }
  return [...folders.values()];
};

const toReason = (error: unknown): Ps4PkgFailure => {
  const code = error instanceof Ps4PkgError ? error.code : "failed";
  return FAILURE_REASONS[code] ?? "failed";
};

/** Checks an update PKG against every linked folder; it goes to the ones it fits. */
const findUpdateTargets = async (
  shop: GameShop,
  objectId: string,
  info: Ps4PkgInfo
): Promise<string[] | Ps4PkgFailure> => {
  const folders = await getGameFolders(shop, objectId);
  if (folders.length === 0) return "no_game_folder";

  const targets: string[] = [];
  let firstProblem: Ps4PkgFailure | null = null;
  for (const folder of folders) {
    try {
      await assertPs4UpdateFits(info, folder);
      targets.push(folder);
    } catch (error) {
      firstProblem ??= toReason(error);
    }
  }
  return targets.length > 0 ? targets : (firstProblem ?? "failed");
};

const readUsablePkg = async (pkgPath: string) => {
  if (!isPs4PkgPath(pkgPath) || !fs.existsSync(pkgPath)) return null;
  const info = await readPs4PkgInfo(pkgPath).catch(() => null);
  return info && !info.isDeltaPatch ? info : null;
};

export const checkPs4Pkg = async (
  shop: GameShop,
  objectId: string,
  pkgPath: string,
  accept: Ps4PkgAccept
): Promise<Ps4PkgCheck> => {
  const wrongKind: Ps4PkgFailure =
    accept === "update" ? "not_update" : "unsupported";
  const info = await readUsablePkg(pkgPath);
  if (!info) return { ok: false, reason: wrongKind };

  if (info.kind === "patch") {
    const targets = await findUpdateTargets(shop, objectId, info);
    if (typeof targets === "string") return { ok: false, reason: targets };
    return {
      ok: true,
      mode: "update",
      version: formatVersion(info.appVersion),
      currentVersion: formatVersion(
        await readPs4FolderParam(targets[0], "APP_VER")
      ),
    };
  }

  if (info.kind === "game" && accept === "any") {
    if (!(await getPs4Game(shop, objectId))) {
      return { ok: false, reason: "failed" };
    }
    return {
      ok: true,
      mode: "extract",
      version: formatVersion(info.appVersion),
      currentVersion: null,
    };
  }

  return { ok: false, reason: wrongKind };
};

export const hasPs4GameFolder = async (shop: GameShop, objectId: string) =>
  (await getGameFolders(shop, objectId)).length > 0;

const sendJob = (event: Ps4PkgJobEvent) =>
  WindowManager.sendToAppWindows("on-ps4-pkg-job", event);

/** Runs one PKG job at a time and tells every window how it goes. */
const runJob = async (
  shop: GameShop,
  objectId: string,
  mode: Ps4PkgJobMode,
  versions: { version?: string | null; currentVersion?: string | null },
  work: (
    signal: AbortSignal,
    onProgress: (fraction: number) => void
  ) => Promise<{ version: string | null }>
): Promise<Ps4PkgResult> => {
  if (running) return { ok: false, reason: "busy" };

  const controller = new AbortController();
  running = { objectId, controller };
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  const base = { shop, objectId, mode, title: game?.title ?? "", ...versions };

  let lastSent = 0;
  const onProgress = (progress: number) => {
    const now = Date.now();
    if (progress > 0 && progress < 1 && now - lastSent < 200) return;
    lastSent = now;
    sendJob({ ...base, phase: "progress", progress });
  };

  try {
    sendJob({ ...base, phase: "start", progress: 0 });
    const { version } = await work(controller.signal, onProgress);
    WindowManager.sendToAppWindows("on-library-batch-complete");
    sendJob({ ...base, phase: "done", progress: 1, version });
    return { ok: true, version };
  } catch (error) {
    const reason = toReason(error);
    if (reason !== "cancelled") logger.error("PS4 PKG job failed", error);
    sendJob({
      ...base,
      phase: reason === "cancelled" ? "cancelled" : "error",
      progress: 0,
      reason,
    });
    return { ok: false, reason };
  } finally {
    running = null;
  }
};

export const applyPs4Update = async (
  shop: GameShop,
  objectId: string,
  pkgPath: string
): Promise<Ps4PkgResult> => {
  const info = await readUsablePkg(pkgPath);
  if (!info || info.kind !== "patch")
    return { ok: false, reason: "not_update" };
  const targets = await findUpdateTargets(shop, objectId, info);
  if (typeof targets === "string") return { ok: false, reason: targets };

  const versions = {
    version: formatVersion(info.appVersion),
    currentVersion: formatVersion(
      await readPs4FolderParam(targets[0], "APP_VER")
    ),
  };

  return runJob(
    shop,
    objectId,
    "update",
    versions,
    async (signal, onProgress) => {
      onProgress(0);
      for (const [index, target] of targets.entries()) {
        await installPs4Pkg({
          pkgPath,
          gameDirectory: target,
          signal,
          onProgress: (fraction) =>
            onProgress((index + fraction) / targets.length),
        });
      }
      onProgress(1);
      return { version: versions.version };
    }
  );
};

/** Swaps the PKG disc for the extracted folder, or adds the folder as a disc. */
const linkExtractedDisc = async (
  shop: GameShop,
  objectId: string,
  pkgPath: string,
  folder: string,
  titleId: string
) => {
  const key = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(key);
  if (!game) return;

  const discs: ClassicsDisc[] = [...(game.discs ?? [])];
  const pkgIndex = discs.findIndex((disc) => samePath(disc.path, pkgPath));
  const hasFolder = discs.some((disc) => samePath(disc.path, folder));
  const folderDisc: ClassicsDisc = {
    path: folder,
    label: getNextClassicsDiscLabel(discs),
    fileName: path.basename(folder),
    sku: normalize(titleId),
  };

  if (pkgIndex >= 0 && hasFolder) {
    discs.splice(pkgIndex, 1);
  } else if (pkgIndex >= 0) {
    discs[pkgIndex] = { ...folderDisc, label: discs[pkgIndex].label };
  } else if (!hasFolder) {
    discs.push(folderDisc);
  }

  const selected = game.selectedDiscPath;
  const selectFolder =
    !selected ||
    samePath(selected, pkgPath) ||
    !discs.some((disc) => disc.path === selected);

  await gamesSublevel.put(key, {
    ...game,
    discs,
    selectedDiscPath: selectFolder ? folder : selected,
  });
};

/** Extracts a PS4 game PKG next to it and links the folder as the game's disc. */
export const extractPs4GamePkg = (
  shop: GameShop,
  objectId: string,
  pkgPath: string,
  launchAfter = false
) =>
  runJob(shop, objectId, "extract", {}, async (signal, onProgress) => {
    const info = await readUsablePkg(pkgPath);
    if (!info || info.kind !== "game") {
      throw new Ps4PkgError("unsupported_pkg", "Not a game PKG");
    }

    const folder = path.join(path.dirname(pkgPath), info.titleId);
    const folderTitleId = isGameFolder(folder)
      ? await readPs4FolderParam(folder, "TITLE_ID")
      : null;
    const alreadyExtracted =
      folderTitleId?.replace(/\W/g, "").toUpperCase() === info.titleId;

    if (!alreadyExtracted) {
      onProgress(0);
      await installPs4Pkg({ pkgPath, signal, onProgress });
    }
    onProgress(1);

    await linkExtractedDisc(shop, objectId, pkgPath, folder, info.titleId);

    if (launchAfter) {
      const { openClassicsGame } = await import(
        "@main/helpers/open-classics-game"
      );
      void openClassicsGame(shop, objectId, folder).catch((error) =>
        logger.error("Failed to launch the extracted PS4 game", error)
      );
    }
    return { version: formatVersion(info.appVersion) };
  });

export const cancelPs4PkgJob = () => running?.controller.abort();

registerEvent(
  "hasPs4GameFolder",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    hasPs4GameFolder(shop, objectId)
);

registerEvent(
  "checkPs4Pkg",
  (
    _event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string,
    pkgPath: string,
    accept: Ps4PkgAccept
  ) => checkPs4Pkg(shop, objectId, pkgPath, accept)
);

registerEvent(
  "applyPs4Update",
  (
    _event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string,
    pkgPath: string
  ) => applyPs4Update(shop, objectId, pkgPath)
);

registerEvent(
  "extractPs4GamePkg",
  (
    _event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string,
    pkgPath: string
  ) => extractPs4GamePkg(shop, objectId, pkgPath)
);

registerEvent("cancelPs4PkgJob", () => cancelPs4PkgJob());
