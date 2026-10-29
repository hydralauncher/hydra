import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT_MARKER_FILE_NAME = ".hydra-screenshots";

const getRootMarkerPath = (screenshotsRoot: string) =>
  path.join(screenshotsRoot, ROOT_MARKER_FILE_NAME);

const isAlreadyExistsError = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === "EEXIST";

export const getScreenshotsRoot = (screenshotPath: string) =>
  path.dirname(path.dirname(screenshotPath));

export const readRootMarkerId = async (screenshotsRoot: string) => {
  try {
    const markerId = await fs.promises.readFile(
      getRootMarkerPath(screenshotsRoot),
      "utf8"
    );
    return markerId.trim() || null;
  } catch {
    return null;
  }
};

const ensureRootMarkerFile = async (markerPath: string) => {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(markerPath, "wx");
  } catch (error) {
    return isAlreadyExistsError(error);
  }

  try {
    await handle.writeFile(randomUUID());
    await handle.close();
    return true;
  } catch {
    await handle.close().catch(() => {});
    await fs.promises.rm(markerPath, { force: true }).catch(() => {});
    return false;
  }
};

export const ensureRootMarkerId = async (screenshotsRoot: string) => {
  const hasMarkerFile = await ensureRootMarkerFile(
    getRootMarkerPath(screenshotsRoot)
  );
  if (!hasMarkerFile) return null;
  return readRootMarkerId(screenshotsRoot);
};
