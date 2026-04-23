import path from "node:path";
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { registerEvent } from "../register-event";
import { gamesSublevel, downloadsSublevel, levelKeys } from "@main/level";
import { findGameRootFromExe } from "../helpers/find-game-root";
import { getDirectorySize } from "../helpers/get-directory-size";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop } from "@types";

const execPromise = promisify(exec);
const THROTTLE_MS = 200;

const activeTransfers = new Map<
  string,
  { paused: boolean; cancelled: boolean }
>();

function send(
  event: string,
  shop: GameShop,
  objectId: string,
  ...args: unknown[]
) {
  WindowManager.mainWindow?.webContents.send(event, shop, objectId, ...args);
}

async function waitIfPaused(id: string) {
  while (true) {
    const s = activeTransfers.get(id);
    if (!s || s.cancelled) throw new Error("cancelled");
    if (!s.paused) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function moveFile(src: string, dest: string) {
  // Use CMD move command - handles spaces, parentheses, and special characters
  await execPromise(`cmd /c move /Y "${src}" "${dest}"`);
}

async function moveDir(
  src: string,
  dest: string,
  id: string,
  counter: { value: number },
  total: number,
  lastSent: { ts: number },
  shop: GameShop,
  objectId: string,
  bytesMoved: { value: number },
  gameSize: number,
  startTime: number
) {
  await waitIfPaused(id);
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    await waitIfPaused(id);

    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await moveDir(
        s,
        d,
        id,
        counter,
        total,
        lastSent,
        shop,
        objectId,
        bytesMoved,
        gameSize,
        startTime
      );
      try {
        await fs.rmdir(s);
      } catch {
        /* not empty yet */
      }
    } else {
      const stats = await fs.stat(s);
      bytesMoved.value += stats.size;

      await moveFile(s, d);
      counter.value++;

      const now = Date.now();
      if (now - lastSent.ts >= THROTTLE_MS) {
        lastSent.ts = now;

        const progress = counter.value / Math.max(total, 1);
        const elapsedSeconds = (now - startTime) / 1000;
        const speedMBps =
          elapsedSeconds > 0
            ? bytesMoved.value / elapsedSeconds / (1024 * 1024)
            : 0;
        const remainingBytes = gameSize - bytesMoved.value;
        const etaSeconds =
          speedMBps > 0 ? remainingBytes / (speedMBps * 1024 * 1024) : 0;

        send("on-game-transfer-progress", shop, objectId, progress, {
          speed: Math.max(0, speedMBps),
          eta: Math.ceil(etaSeconds),
          transferred: bytesMoved.value,
          total: gameSize,
        });
      }
    }
  }
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries)
      n += e.isDirectory() ? await countFiles(path.join(dir, e.name)) : 1;
  } catch {
    /* skip unreadable */
  }
  return n;
}

registerEvent(
  "transferGameFiles",
  async (_event, shop: GameShop, objectId: string, destParent: string) => {
    const startTime = Date.now();

    send("on-game-transfer-progress", shop, objectId, 0);

    const id = `${shop}:${objectId}`;
    activeTransfers.set(id, { paused: false, cancelled: false });

    const gameKey = levelKeys.game(shop, objectId);

    let game;
    try {
      game = await gamesSublevel.get(gameKey);
    } catch {
      activeTransfers.delete(id);
      return { ok: false, error: "Game not found" };
    }

    if (!game?.executablePath) {
      activeTransfers.delete(id);
      return { ok: false, error: "No executable selected" };
    }

    const exePath = game.executablePath;
    const gameRoot = await findGameRootFromExe(exePath).catch(() => null);
    if (!gameRoot) {
      activeTransfers.delete(id);
      return { ok: false, error: "Cannot determine game root folder" };
    }

    const folderName = path.basename(gameRoot);
    const targetRoot = path.join(destParent, folderName);
    const gameSize = await getDirectorySize(gameRoot);

    if (path.resolve(gameRoot) === path.resolve(targetRoot)) {
      activeTransfers.delete(id);
      return {
        ok: false,
        error: "Same folder - game is already in this location",
      };
    }
    if (targetRoot.startsWith(gameRoot + path.sep)) {
      activeTransfers.delete(id);
      return { ok: false, error: "Destination is inside source folder" };
    }

    const total = await countFiles(gameRoot);
    const counter = { value: 0 };
    const lastSent = { ts: 0 };
    const bytesMoved = { value: 0 };

    try {
      await fs.mkdir(destParent, { recursive: true });
      await moveDir(
        gameRoot,
        targetRoot,
        id,
        counter,
        total,
        lastSent,
        shop,
        objectId,
        bytesMoved,
        gameSize,
        startTime
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      activeTransfers.delete(id);
      if (msg === "cancelled") {
        send("on-game-transfer-cancelled", shop, objectId);
        return { ok: false, error: "Transfer cancelled" };
      }
      send("on-game-transfer-error", shop, objectId, msg);
      return { ok: false, error: msg };
    }

    send("on-game-transfer-progress", shop, objectId, 1);

    const relExe = path.relative(gameRoot, exePath);
    const newExePath = path.join(targetRoot, relExe);
    const installedSizeInBytes = await getDirectorySize(targetRoot);

    try {
      await gamesSublevel.put(gameKey, {
        ...game,
        executablePath: newExePath,
        installedSizeInBytes,
      });

      const download = await downloadsSublevel.get(gameKey).catch(() => null);
      if (download) {
        await downloadsSublevel.put(gameKey, {
          ...download,
          downloadPath: destParent,
          folderName,
        });
      }
    } catch {
      activeTransfers.delete(id);
      return { ok: false, error: "Failed to update database" };
    }

    await fs
      .rm(gameRoot, { recursive: true, force: true })
      .catch((e) => console.error("[transfer] failed to delete source:", e));

    activeTransfers.delete(id);
    send("on-game-transfer-complete", shop, objectId, newExePath);
    return { ok: true, newExePath };
  }
);

registerEvent(
  "pauseGameTransfer",
  async (_e, shop: GameShop, objectId: string) => {
    const s = activeTransfers.get(`${shop}:${objectId}`);
    if (s) s.paused = true;
  }
);

registerEvent(
  "resumeGameTransfer",
  async (_e, shop: GameShop, objectId: string) => {
    const s = activeTransfers.get(`${shop}:${objectId}`);
    if (s) s.paused = false;
  }
);

registerEvent(
  "cancelGameTransfer",
  async (_e, shop: GameShop, objectId: string) => {
    const s = activeTransfers.get(`${shop}:${objectId}`);
    if (s) {
      s.cancelled = true;
      s.paused = false;
    }
  }
);
