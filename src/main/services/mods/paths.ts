import path from "node:path";
import { SystemPath } from "../system-path";

export const modsRoot = path.join(SystemPath.getPath("userData"), "Mods");
export const modsCachePath = path.join(modsRoot, "cache");
export const modsDownloadsPath = path.join(modsRoot, "downloads");
export const modsStatePath = path.join(modsRoot, "state");
export const modsBackupsPath = path.join(modsRoot, "backups");
export const modsTempPath = path.join(modsRoot, "tmp");

export const gameKey = (shop: string, objectId: string) =>
  `${shop}-${objectId}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
