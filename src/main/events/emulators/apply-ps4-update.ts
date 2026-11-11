import fs from "node:fs";
import path from "node:path";

import type {
  GameShop,
  Ps4UpdateCheck,
  Ps4UpdateFailure,
  Ps4UpdateResult,
} from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { platformToSystem } from "@main/helpers";
import { logger, WindowManager } from "@main/services";
import {
  assertPs4UpdateFits,
  installPs4Pkg,
  isPs4PkgPath,
  Ps4PkgError,
  readPs4FolderParam,
  readPs4PkgInfo,
  type Ps4PkgInfo,
} from "@main/services/ps4-pkg";
import { getRecompilationGameFolder } from "../recompilation/recompilation-rom";
import { registerEvent } from "../register-event";

const FAILURE_REASONS: Record<string, Ps4UpdateResult["reason"]> = {
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

/** The extracted game folders linked to a PS4 game: shadPS4 discs and ports. */
const getGameFolders = async (shop: GameShop, objectId: string) => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => undefined);
  if (!game || platformToSystem(game.platform) !== "ps4") return [];

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

const toReason = (error: unknown): Ps4UpdateResult["reason"] => {
  const code = error instanceof Ps4PkgError ? error.code : "failed";
  return FAILURE_REASONS[code] ?? "failed";
};

type UpdateTargets =
  | { info: Ps4PkgInfo; targets: string[] }
  | { reason: Ps4UpdateFailure };

/** Checks the PKG against every linked folder; the ones it fits get updated. */
const findTargets = async (
  shop: GameShop,
  objectId: string,
  pkgPath: string
): Promise<UpdateTargets> => {
  if (!isPs4PkgPath(pkgPath) || !fs.existsSync(pkgPath)) {
    return { reason: "not_update" };
  }

  const info = await readPs4PkgInfo(pkgPath).catch(() => null);
  if (!info || info.kind !== "patch" || info.isDeltaPatch) {
    return { reason: "not_update" };
  }

  const folders = await getGameFolders(shop, objectId);
  if (folders.length === 0) return { reason: "no_game_folder" };

  const targets: string[] = [];
  let firstProblem: Ps4UpdateResult["reason"] | null = null;
  for (const folder of folders) {
    try {
      await assertPs4UpdateFits(info, folder);
      targets.push(folder);
    } catch (error) {
      firstProblem ??= toReason(error);
    }
  }

  if (targets.length === 0) return { reason: firstProblem ?? "failed" };
  return { info, targets };
};

export const checkPs4Update = async (
  shop: GameShop,
  objectId: string,
  pkgPath: string
): Promise<Ps4UpdateCheck> => {
  const found = await findTargets(shop, objectId, pkgPath);
  if (!("targets" in found)) return { ok: false, reason: found.reason };

  return {
    ok: true,
    version: formatVersion(found.info.appVersion),
    currentVersion: formatVersion(
      await readPs4FolderParam(found.targets[0], "APP_VER")
    ),
  };
};

export const hasPs4GameFolder = async (shop: GameShop, objectId: string) =>
  (await getGameFolders(shop, objectId)).length > 0;

export const applyPs4Update = async (
  shop: GameShop,
  objectId: string,
  pkgPath: string
): Promise<Ps4UpdateResult> => {
  if (running) return { ok: false, reason: "busy" };

  const controller = new AbortController();
  running = { objectId, controller };
  const sendProgress = (progress: number) =>
    WindowManager.mainWindow?.webContents.send("on-ps4-update-progress", {
      objectId,
      progress,
    });

  try {
    const found = await findTargets(shop, objectId, pkgPath);
    if (!("targets" in found)) return { ok: false, reason: found.reason };

    sendProgress(0);
    for (const [index, target] of found.targets.entries()) {
      await installPs4Pkg({
        pkgPath,
        gameDirectory: target,
        signal: controller.signal,
        onProgress: (fraction) =>
          sendProgress((index + fraction) / found.targets.length),
      });
    }
    sendProgress(1);

    WindowManager.sendToAppWindows("on-library-batch-complete");
    return { ok: true, version: formatVersion(found.info.appVersion) };
  } catch (error) {
    const reason = toReason(error);
    if (reason !== "cancelled") {
      logger.error("Failed to apply PS4 update", error);
    }
    return { ok: false, reason };
  } finally {
    running = null;
  }
};

export const cancelPs4Update = () => running?.controller.abort();

registerEvent(
  "hasPs4GameFolder",
  (_event: Electron.IpcMainInvokeEvent, shop: GameShop, objectId: string) =>
    hasPs4GameFolder(shop, objectId)
);

registerEvent(
  "checkPs4Update",
  (
    _event: Electron.IpcMainInvokeEvent,
    shop: GameShop,
    objectId: string,
    pkgPath: string
  ) => checkPs4Update(shop, objectId, pkgPath)
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

registerEvent("cancelPs4Update", () => cancelPs4Update());
