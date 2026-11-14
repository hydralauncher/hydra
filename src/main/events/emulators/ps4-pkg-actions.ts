import fs from "node:fs";
import path from "node:path";

import type {
  ClassicsDisc,
  GameShop,
  Ps4PkgAccept,
  Ps4PkgCheck,
  Ps4PkgFailure,
  Ps4PkgResult,
} from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import { platformToSystem } from "@main/helpers";
import { publishExtractionCompleteNotification } from "@main/services/notifications";
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
import {
  getRecompilationGameFolder,
  listRecompilationGameFolders,
} from "../recompilation/recompilation-rom";
import { registerEvent } from "../register-event";
import {
  cancelPs4PkgJob,
  formatPs4Version,
  runPs4PkgJob,
  toPs4PkgFailure,
} from "./ps4-pkg-job";

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
  const candidates: (string | null)[] = [];
  for (const disc of game?.discs ?? []) {
    candidates.push(
      disc.recompilationSlug
        ? await getRecompilationGameFolder(objectId, disc.recompilationSlug)
        : toGameFolder(disc.path)
    );
  }
  // A port's game is found through the port too, in or out of the library.
  if (shop === "launchbox") {
    candidates.push(...(await listRecompilationGameFolders(objectId)));
  }

  const folders = new Map<string, string>();
  for (const folder of candidates) {
    if (!folder || !isGameFolder(folder)) continue;
    const key = path.resolve(folder).toLowerCase();
    if (!folders.has(key)) folders.set(key, folder);
  }
  return [...folders.values()];
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
      firstProblem ??= toPs4PkgFailure(error);
    }
  }
  return targets.length > 0 ? targets : (firstProblem ?? "failed");
};

const readUsablePkg = async (pkgPath: string) => {
  if (!isPs4PkgPath(pkgPath) || !fs.existsSync(pkgPath)) return null;
  const info = await readPs4PkgInfo(pkgPath).catch(() => null);
  return info && !info.isDeltaPatch ? info : null;
};

/** Files of a running game are in use, so updates wait until it closes. */
export const isPs4GameRunning = async (shop: GameShop, objectId: string) => {
  const { emulatorSessions } = await import(
    "@main/services/emulators/emulator-session-tracker"
  );
  if (emulatorSessions.has(levelKeys.game(shop, objectId))) return true;
  if (shop !== "launchbox") return false;
  const { findRunningRecompilation } = await import(
    "../recompilation/recompilation-session"
  );
  return findRunningRecompilation(objectId) !== null;
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
    if (await isPs4GameRunning(shop, objectId)) {
      return { ok: false, reason: "game_running" };
    }
    const targets = await findUpdateTargets(shop, objectId, info);
    if (typeof targets === "string") return { ok: false, reason: targets };
    return {
      ok: true,
      mode: "update",
      version: formatPs4Version(info.appVersion),
      currentVersion: formatPs4Version(
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
      version: formatPs4Version(info.appVersion),
      currentVersion: null,
    };
  }

  return { ok: false, reason: wrongKind };
};

export const hasPs4GameFolder = async (shop: GameShop, objectId: string) =>
  (await getGameFolders(shop, objectId)).length > 0;

export const applyPs4Update = async (
  shop: GameShop,
  objectId: string,
  pkgPath: string
): Promise<Ps4PkgResult> => {
  const info = await readUsablePkg(pkgPath);
  if (!info || info.kind !== "patch")
    return { ok: false, reason: "not_update" };
  if (await isPs4GameRunning(shop, objectId)) {
    return { ok: false, reason: "game_running" };
  }
  const targets = await findUpdateTargets(shop, objectId, info);
  if (typeof targets === "string") return { ok: false, reason: targets };

  const versions = {
    version: formatPs4Version(info.appVersion),
    currentVersion: formatPs4Version(
      await readPs4FolderParam(targets[0], "APP_VER")
    ),
  };

  return runPs4PkgJob(
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
export const linkExtractedDisc = async (
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

/** The PKG disc the game would play: the selected one, else the first. */
const getSelectedPkgDisc = async (shop: GameShop, objectId: string) => {
  const game = await getPs4Game(shop, objectId);
  const selected = game?.selectedDiscPath ?? game?.discs?.[0]?.path ?? null;
  return selected && isPs4PkgPath(selected) ? selected : null;
};

/**
 * Extracts a PS4 game PKG next to it and links the folder as the game's disc.
 * Without a path it extracts the PKG disc the game would play.
 */
export const extractPs4GamePkg = async (
  shop: GameShop,
  objectId: string,
  pkgPath?: string | null
): Promise<Ps4PkgResult> => {
  const source = pkgPath ?? (await getSelectedPkgDisc(shop, objectId));
  if (!source) return { ok: false, reason: "unsupported" };

  return runPs4PkgJob(
    shop,
    objectId,
    "extract",
    {},
    async (signal, onProgress) => {
      const info = await readUsablePkg(source);
      if (!info || info.kind !== "game") {
        throw new Ps4PkgError("unsupported_pkg", "Not a game PKG");
      }

      const folder = path.join(path.dirname(source), info.titleId);
      const folderTitleId = isGameFolder(folder)
        ? await readPs4FolderParam(folder, "TITLE_ID")
        : null;
      const alreadyExtracted =
        folderTitleId?.replace(/\W/g, "").toUpperCase() === info.titleId;

      if (!alreadyExtracted) {
        onProgress(0);
        await installPs4Pkg({ pkgPath: source, signal, onProgress });
      }
      onProgress(1);

      await linkExtractedDisc(shop, objectId, source, folder, info.titleId);

      const game = await getPs4Game(shop, objectId);
      if (game) void publishExtractionCompleteNotification(game);
      return { version: formatPs4Version(info.appVersion) };
    }
  );
};

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
    pkgPath?: string | null
  ) => extractPs4GamePkg(shop, objectId, pkgPath)
);

registerEvent("cancelPs4PkgJob", () => cancelPs4PkgJob());
