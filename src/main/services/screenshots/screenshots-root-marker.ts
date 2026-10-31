import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { logger } from "../logger";

const ROOT_MARKER_FILE_NAME = ".hydra-screenshots";
const HIDE_MARKER_TIMEOUT_MS = 5000;
const MARKER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hiddenMarkerPaths = new Set<string>();
const pendingMarkerIds = new Map<string, Promise<string | null>>();

const getRootMarkerPath = (screenshotsRoot: string) =>
  path.join(screenshotsRoot, ROOT_MARKER_FILE_NAME);

const isAlreadyExistsError = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === "EEXIST";

const parseMarkerId = (content: string) => {
  const markerId = content.trim();
  return MARKER_ID_PATTERN.test(markerId) ? markerId : null;
};

export const getScreenshotsRoot = (screenshotPath: string) =>
  path.dirname(path.dirname(screenshotPath));

export const readRootMarkerId = async (screenshotsRoot: string) => {
  try {
    const content = await fs.promises.readFile(
      getRootMarkerPath(screenshotsRoot),
      "utf8"
    );
    return parseMarkerId(content);
  } catch {
    return null;
  }
};

const getAttribPath = () => {
  const systemRoot = process.env.SystemRoot ?? process.env.windir;
  return systemRoot
    ? path.win32.join(systemRoot, "System32", "attrib.exe")
    : null;
};

const hideMarkerFile = (markerPath: string) => {
  if (process.platform !== "win32" || hiddenMarkerPaths.has(markerPath)) {
    return Promise.resolve();
  }
  const attribPath = getAttribPath();
  if (!attribPath) return Promise.resolve();
  hiddenMarkerPaths.add(markerPath);

  return new Promise<void>((resolve) => {
    execFile(
      attribPath,
      ["+h", markerPath],
      { timeout: HIDE_MARKER_TIMEOUT_MS, windowsHide: true },
      (error) => {
        if (error) {
          logger.warn("Failed to hide the screenshots root marker", {
            markerPath,
            error,
          });
        }
        resolve();
      }
    );
  });
};

const writeMarkerId = async (handle: fs.promises.FileHandle) => {
  await handle.truncate(0);
  await handle.write(randomUUID(), 0);
  await handle.sync();
};

const createMarkerFile = async (markerPath: string) => {
  let handle: fs.promises.FileHandle;
  try {
    handle = await fs.promises.open(markerPath, "wx");
  } catch (error) {
    return isAlreadyExistsError(error) ? "exists" : "failed";
  }

  try {
    await writeMarkerId(handle);
    await handle.close();
    return "created";
  } catch {
    await handle.close().catch(() => {});
    await fs.promises.rm(markerPath, { force: true }).catch(() => {});
    return "failed";
  }
};

const repairMarkerFile = async (markerPath: string) => {
  const handle = await fs.promises.open(markerPath, "r+");
  try {
    if (!parseMarkerId(await handle.readFile("utf8"))) {
      await writeMarkerId(handle);
    }
  } finally {
    await handle.close();
  }
};

const hasUsableMarkerFile = async (
  screenshotsRoot: string,
  markerPath: string
) => {
  const markerStat = await fs.promises.stat(markerPath).catch(() => null);
  if (!markerStat?.isFile()) return false;
  if (await readRootMarkerId(screenshotsRoot)) return true;
  return repairMarkerFile(markerPath).then(
    () => true,
    () => false
  );
};

const resolveRootMarkerId = async (screenshotsRoot: string) => {
  const markerPath = getRootMarkerPath(screenshotsRoot);
  const creation = await createMarkerFile(markerPath);
  if (creation === "failed") return null;

  if (creation === "created") {
    hiddenMarkerPaths.delete(markerPath);
  } else if (!(await hasUsableMarkerFile(screenshotsRoot, markerPath))) {
    return null;
  }

  await hideMarkerFile(markerPath);
  return readRootMarkerId(screenshotsRoot);
};

export const ensureRootMarkerId = (screenshotsRoot: string) => {
  const pending = pendingMarkerIds.get(screenshotsRoot);
  if (pending !== undefined) return pending;

  const markerId = resolveRootMarkerId(screenshotsRoot).finally(() => {
    pendingMarkerIds.delete(screenshotsRoot);
  });
  pendingMarkerIds.set(screenshotsRoot, markerId);
  return markerId;
};
