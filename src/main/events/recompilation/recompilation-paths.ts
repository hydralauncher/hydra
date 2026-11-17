import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { RecompilationRef } from "@types";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";
import { recompilationInstallsSublevel } from "@main/level";
import { getPrefixFolders, rememberPortRuntime } from "./recompilation-proton";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/i;
const OBJECT_ID_PATTERN = /^\d{1,20}$/;

export const parseRecompilationRef = (
  ref: unknown
): RecompilationRef | null => {
  if (!ref || typeof ref !== "object") return null;
  const { objectId, slug } = ref as Record<string, unknown>;
  if (typeof objectId !== "string" || !OBJECT_ID_PATTERN.test(objectId)) {
    return null;
  }
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug)) return null;
  return { objectId, slug };
};

const readSavedInstallDirectory = async (slug: string) => {
  const directory = await recompilationInstallsSublevel
    .get(slug)
    .catch(() => undefined);
  return typeof directory === "string" && path.isAbsolute(directory)
    ? directory
    : null;
};

const LEGACY_INSTALL_FOLDER = "recompilations";

export const listDefaultRecompilationParents = async () => {
  const downloadsPath = await getDownloadsPath();
  return [downloadsPath, path.join(downloadsPath, LEGACY_INSTALL_FOLDER)];
};

export const getRecompilationInstallDirectory = async (slug: string) => {
  const saved = await readSavedInstallDirectory(slug);
  if (saved && (await readInstallMarker(saved))?.slug === slug) return saved;

  const [defaultParent, legacyParent] = await listDefaultRecompilationParents();
  const legacy = path.join(legacyParent, slug);
  if ((await readInstallMarker(legacy))?.slug === slug) return legacy;
  const defaultDirectory = path.join(defaultParent, slug);
  await readInstallMarker(defaultDirectory);
  return defaultDirectory;
};

export const INSTALL_MARKER_FILE = ".hydra-recompilation.json";

export interface InstallMarker {
  slug: string;
  objectId: string;
  version: string;
  assetName: string;
  executablePath: string | null;
  installedAt: string;
  name?: string;
  iconUrl?: string | null;
  // A folder the user picked with "Select folder": Hydra never deletes it whole.
  linked?: boolean;
  // Files Hydra wrote into a linked folder, relative to it.
  installedFiles?: string[];
  // The linked folder's program was confirmed as this port's.
  verified?: boolean;
}

/** Folders linked before the flag existed have no release file name. */
export const isLinkedInstall = (marker: InstallMarker | null) =>
  marker?.linked === true || marker?.assetName === "";

export const readInstallMarker = async (
  installDirectory: string
): Promise<InstallMarker | null> => {
  try {
    const raw = await fs.promises.readFile(
      path.join(installDirectory, INSTALL_MARKER_FILE),
      "utf-8"
    );
    const marker = JSON.parse(raw) as InstallMarker;
    if (marker?.slug) rememberPortRuntime(marker.slug, marker.executablePath);
    return marker;
  } catch {
    return null;
  }
};

export const getRecompilationBaseDirectory = async (
  installDirectory: string
) => {
  const executablePath = (await readInstallMarker(installDirectory))
    ?.executablePath;
  if (!executablePath) return installDirectory;

  const directory = path.dirname(executablePath);
  const relative = path.relative(installDirectory, directory);
  return relative.startsWith("..") || path.isAbsolute(relative)
    ? installDirectory
    : directory;
};

export const saveRecompilationInstallDirectory = (
  slug: string,
  directory: string
) => recompilationInstallsSublevel.put(slug, directory);

export const forgetRecompilationInstallDirectory = (slug: string) =>
  recompilationInstallsSublevel.del(slug);

export const isRecompilationFolderMissing = async (slug: string) => {
  const saved = await readSavedInstallDirectory(slug);
  if (!saved) return false;
  return fs.promises
    .stat(saved)
    .then(() => false)
    .catch((error: NodeJS.ErrnoException) => error.code === "ENOENT");
};

export const resolveRecompilationPath = (
  template: string,
  baseDirectory: string,
  romName = "",
  winePrefix: string | null = null
) => {
  const prefixFolders = winePrefix ? getPrefixFolders(winePrefix) : null;
  const home = prefixFolders?.home ?? os.homedir();
  const values: Record<string, string> = {
    "<base>": baseDirectory,
    "<home>": home,
    "<winLocalAppData>":
      prefixFolders?.winLocalAppData ??
      process.env.LOCALAPPDATA ??
      path.join(home, "AppData", "Local"),
    "<winAppData>":
      prefixFolders?.winAppData ??
      process.env.APPDATA ??
      path.join(home, "AppData", "Roaming"),
    "<xdgData>":
      process.env.XDG_DATA_HOME || path.join(home, ".local", "share"),
    "<xdgConfig>": process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    "{romName}": romName,
  };
  values["<appData>"] =
    process.platform === "win32" || prefixFolders
      ? values["<winAppData>"]
      : values["<xdgData>"];

  return path.normalize(
    template.replace(
      /<base>|<home>|<winLocalAppData>|<winAppData>|<xdgData>|<xdgConfig>|<appData>|\{romName\}/g,
      (token) => values[token]
    )
  );
};
