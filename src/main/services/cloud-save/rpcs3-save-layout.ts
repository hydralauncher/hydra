import path from "node:path";

import YAML from "yaml";

import type { Game } from "@types";
import {
  rpcs3SavedataTitleIdsForGame,
  rpcs3TitleIdsForGame,
} from "./rpcs3-title-ids.js";

export { rpcs3TitleIdsForGame } from "./rpcs3-title-ids.js";

const PROFILE_ID = /^\d{8}$/;

export const parseRpcs3ActiveProfileId = (content: string | null) => {
  if (content === null) return "00000001";
  let inUsers = false;
  let activeProfileId = "00000001";
  for (const raw of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = /^\[(.+?)\]$/.exec(line);
    if (section) {
      inUsers = section[1].toLowerCase() === "users";
      continue;
    }
    if (!inUsers) continue;
    const value = /^active_user\s*=\s*(.*?)\s*$/i.exec(line);
    if (value) activeProfileId = value[1] || "00000001";
  }
  return PROFILE_ID.test(activeProfileId) && activeProfileId !== "00000000"
    ? activeProfileId
    : null;
};

export const rpcs3SlotBelongsToTitle = (slotName: string, titleId: string) =>
  slotName.startsWith(titleId);

const SAVESTATE_NAME =
  /^([A-Z]{4}\d{5})_[A-Za-z0-9]_[0-9]+\.SAVESTAT(?:\.zst|\.gz)?$/;

export const rpcs3SavestateFileBelongsToTitle = (
  fileName: string,
  titleId: string
) => SAVESTATE_NAME.exec(fileName)?.[1] === titleId;

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
  return (
    savedataIndex >= 0 &&
    savedataIndex < segments.length - 2 &&
    savedataTitleIds.some((id) =>
      rpcs3SlotBelongsToTitle(segments[savedataIndex + 1], id)
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
