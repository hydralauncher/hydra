import fs from "node:fs";

import { inspectGalaxyDll, type GalaxyDll } from "./galaxy-dll.js";
import { sha256 } from "./release.js";

/**
 * Hydra keeps the original GOG Galaxy DLL next to the game's copy and writes a
 * small marker describing what it replaced. The marker is the only thing that
 * allows Hydra to restore a DLL, so files Hydra did not install are never
 * overwritten or removed.
 */
export const BACKUP_SUFFIX = ".hydra-original";
export const MARKER_SUFFIX = ".hydra-universelan.json";

export interface UniverseLanInstallMarker {
  sdkVersion: string;
  build: string;
  originalSha256: string;
  installedSha256: string;
  installedAt: string;
}

export const getBackupPath = (dllPath: string) => `${dllPath}${BACKUP_SUFFIX}`;
export const getMarkerPath = (dllPath: string) => `${dllPath}${MARKER_SUFFIX}`;

const readFileSha256 = async (filePath: string) =>
  sha256(await fs.promises.readFile(filePath));

const fileExists = async (filePath: string) => {
  try {
    return (await fs.promises.stat(filePath)).isFile();
  } catch {
    return false;
  }
};

/** Copies through a temporary file so a failed copy never leaves a half DLL. */
const replaceFile = async (sourcePath: string, targetPath: string) => {
  const temporaryPath = `${targetPath}.hydra-tmp`;

  try {
    await fs.promises.copyFile(sourcePath, temporaryPath);
    await fs.promises.rename(temporaryPath, targetPath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true });
  }
};

export const readInstallMarker = async (
  dllPath: string
): Promise<UniverseLanInstallMarker | null> => {
  try {
    const marker = JSON.parse(
      await fs.promises.readFile(getMarkerPath(dllPath), "utf-8")
    );

    return typeof marker?.installedSha256 === "string" &&
      typeof marker?.originalSha256 === "string"
      ? marker
      : null;
  } catch {
    return null;
  }
};

/** True when the DLL on disk is still the UniverseLAN copy Hydra installed. */
export const isHydraInstalled = async (dllPath: string) => {
  const marker = await readInstallMarker(dllPath);

  if (!marker || !(await fileExists(getBackupPath(dllPath)))) return false;

  return (await readFileSha256(dllPath)) === marker.installedSha256;
};

export const installUniverseLanDll = async ({
  dll,
  replacementPath,
  sdkVersion,
  build,
}: {
  dll: GalaxyDll;
  replacementPath: string;
  sdkVersion: string;
  build: string;
}): Promise<UniverseLanInstallMarker> => {
  // Inspect the file again right before touching it: only a genuine GOG DLL
  // (possibly updated by the game) may become the backup.
  const current =
    dll.kind === "gog"
      ? await inspectGalaxyDll(dll.filePath, dll.architecture)
      : dll;

  if (current.kind !== "gog") {
    throw new Error(
      `Refusing to replace a non GOG Galaxy DLL: ${dll.filePath}`
    );
  }

  const backupPath = getBackupPath(dll.filePath);
  const markerPath = getMarkerPath(dll.filePath);

  // Read the replacement first so a missing package fails before any change.
  const installedSha256 = await readFileSha256(replacementPath);

  await replaceFile(dll.filePath, backupPath);

  const marker: UniverseLanInstallMarker = {
    sdkVersion,
    build,
    originalSha256: await readFileSha256(backupPath),
    installedSha256,
    installedAt: new Date().toISOString(),
  };

  // The recovery record is written before the swap, so an interrupted install
  // can always be restored.
  await fs.promises.writeFile(markerPath, JSON.stringify(marker, null, 2));

  try {
    await replaceFile(replacementPath, dll.filePath);
  } catch (error) {
    // replaceFile never leaves a partial DLL, so the original is still in
    // place: drop the recovery files instead of leaving a stale backup.
    await Promise.all([
      fs.promises.rm(backupPath, { force: true }),
      fs.promises.rm(markerPath, { force: true }),
    ]);
    throw error;
  }

  return marker;
};

export type RestoreResult = "restored" | "not-installed" | "replaced-by-game";

export const restoreGalaxyDll = async (
  dllPath: string
): Promise<RestoreResult> => {
  const marker = await readInstallMarker(dllPath);
  const backupPath = getBackupPath(dllPath);

  if (!marker || !(await fileExists(backupPath))) return "not-installed";

  const cleanUp = () =>
    Promise.all([
      fs.promises.rm(backupPath, { force: true }),
      fs.promises.rm(getMarkerPath(dllPath), { force: true }),
    ]);

  const currentSha256 = (await fileExists(dllPath))
    ? await readFileSha256(dllPath)
    : null;

  // The game (or the user) put another DLL in place: keep it, drop our backup.
  if (currentSha256 !== null && currentSha256 !== marker.installedSha256) {
    await cleanUp();
    return "replaced-by-game";
  }

  if ((await readFileSha256(backupPath)) !== marker.originalSha256) {
    throw new Error(`Backup of ${dllPath} does not match the original DLL`);
  }

  await replaceFile(backupPath, dllPath);
  await cleanUp();

  return "restored";
};
