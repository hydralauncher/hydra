import fs from "node:fs";
import path from "node:path";

import type { RecompilationRef } from "@types";
import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";
import { recompilationInstallsSublevel } from "@main/level";

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

export const getRecompilationInstallDirectory = async (slug: string) =>
  (await readSavedInstallDirectory(slug)) ??
  path.join(await getDownloadsPath(), "recompilations", slug);

export const INSTALL_MARKER_FILE = ".hydra-recompilation.json";

export interface InstallMarker {
  slug: string;
  objectId: string;
  version: string;
  assetName: string;
  executablePath: string | null;
  installedAt: string;
}

export const readInstallMarker = async (
  installDirectory: string
): Promise<InstallMarker | null> => {
  try {
    const raw = await fs.promises.readFile(
      path.join(installDirectory, INSTALL_MARKER_FILE),
      "utf-8"
    );
    return JSON.parse(raw) as InstallMarker;
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
