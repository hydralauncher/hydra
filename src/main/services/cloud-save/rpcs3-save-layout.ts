import path from "node:path";

import YAML from "yaml";

import type { Game } from "@types";
import {
  rpcs3SavedataTitleIdsForGame,
  rpcs3TitleIdsForGame,
} from "./rpcs3-title-ids.js";

export { rpcs3TitleIdsForGame } from "./rpcs3-title-ids.js";

export const rpcs3SlotBelongsToTitle = (slotName: string, titleId: string) =>
  slotName.startsWith(titleId);

const SAVESTATE_NAME =
  /^([A-Z]{4}\d{5})_[A-Za-z0-9]_[0-9]+\.SAVESTAT(?:\.zst|\.gz)?$/;

export const rpcs3SavestateFileBelongsToTitle = (
  fileName: string,
  titleId: string
) => SAVESTATE_NAME.exec(fileName)?.[1] === titleId;

const GAMEDATA_PROFILE_FOLDER = /^([A-Z]{4}\d{5})_USER\d+$/;

export const rpcs3GamedataFolderBelongsToTitle = (
  folderName: string,
  titleId: string
) => GAMEDATA_PROFILE_FOLDER.exec(folderName)?.[1] === titleId;

export const isRpcs3GameSaveFile = (
  game: Game,
  filePath: string,
  savedataTitleIds: readonly string[] = rpcs3SavedataTitleIdsForGame(game)
) => {
  const titleIds = rpcs3TitleIdsForGame(game);
  if (!titleIds.length) return false;
  const segments = path.resolve(filePath).split(path.sep);
  const fileName = segments.at(-1) ?? "";
  if (titleIds.some((id) => rpcs3SavestateFileBelongsToTitle(fileName, id)))
    return true;
  const savedataIndex = segments.lastIndexOf("savedata");
  if (
    savedataIndex >= 0 &&
    savedataIndex < segments.length - 2 &&
    savedataTitleIds.some((id) =>
      rpcs3SlotBelongsToTitle(segments[savedataIndex + 1], id)
    )
  ) {
    return true;
  }
  const gameIndex = segments.lastIndexOf("game");
  return (
    gameIndex >= 0 &&
    gameIndex < segments.length - 2 &&
    savedataTitleIds.some((id) =>
      rpcs3GamedataFolderBelongsToTitle(segments[gameIndex + 1], id)
    )
  );
};

export const resolveRpcs3VfsHdd0 = (
  configRoot: string,
  vfsContent: string | null
) => {
  if (vfsContent === null) return path.join(configRoot, "dev_hdd0");
  const config = YAML.parse(vfsContent) as Record<string, unknown> | null;
  if (!config || typeof config !== "object") {
    throw new Error("cloud_save_rpcs3_vfs_invalid");
  }
  const emulatorDir = config["$(EmulatorDir)"];
  if (emulatorDir !== undefined && typeof emulatorDir !== "string") {
    throw new Error("cloud_save_rpcs3_vfs_invalid");
  }
  if (emulatorDir && !path.isAbsolute(emulatorDir)) {
    throw new Error("cloud_save_rpcs3_vfs_unresolved");
  }
  const base =
    typeof emulatorDir === "string" && emulatorDir
      ? path.normalize(emulatorDir)
      : configRoot;
  const configured = config["/dev_hdd0/"];
  if (configured !== undefined && typeof configured !== "string") {
    throw new Error("cloud_save_rpcs3_vfs_invalid");
  }
  const value = configured ?? "$(EmulatorDir)dev_hdd0/";
  if (!value || /\$\((?!EmulatorDir\))/.test(value)) {
    throw new Error("cloud_save_rpcs3_vfs_unresolved");
  }
  const expanded = value.replaceAll("$(EmulatorDir)", `${base}${path.sep}`);
  if (!path.isAbsolute(expanded)) {
    throw new Error("cloud_save_rpcs3_vfs_unresolved");
  }
  return path.resolve(expanded);
};
