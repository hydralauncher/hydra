import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { registerEvent } from "../register-event";
import { gamesSublevel, downloadsSublevel, levelKeys } from "@main/level";
import { findGameRootFromExe } from "../helpers/find-game-root";
import { getDirectorySize } from "../helpers/get-directory-size";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop } from "@types";

// ── HELPERS ──────────────────────────────────────────────────────────────────
function send(event: string, shop: GameShop, objectId: string, ...args: unknown[]) {
  WindowManager.mainWindow?.webContents.send(event, shop, objectId, ...args);
}

function sameDrive(a: string, b: string) {
  return path.parse(a).root.toUpperCase() === path.parse(b).root.toUpperCase();
}

// ── STATE MANAGEMENT ─────────────────────────────────────────────────────────
const activeTransfers = new Map<
  string,
  { paused: boolean; cancelled: boolean }
>();

// ── CUSTOM CROSS‑DRIVE COPY WITH PROGRESS ────────────────────────────────────
/**
 * Recursively copy a directory while reporting progress.
 * Checks activeTransfers for cancellation / pause.
 */
async function copyDirectoryWithProgress(
  src: string,
  dest: string,
  totalSize: number,
  id: string,
  shop: GameShop,
  objectId: string,
  startTime: number
): Promise<void> {
  let bytesCopied = 0;
  let lastSent = 0;
  const CONCURRENCY = 8; // number of parallel file copies

  // Throttled progress sender
  const notifyProgress = () => {
    const now = Date.now();
    if (now - lastSent < 150) return;
    lastSent = now;
    const progress = Math.min(bytesCopied / Math.max(totalSize, 1), 0.99);
    const elapsedSec = (now - startTime) / 1000;
    const speedMBps = elapsedSec > 0 ? bytesCopied / elapsedSec / 1_048_576 : 0;
    const etaSeconds = speedMBps > 0 ? (totalSize - bytesCopied) / (speedMBps * 1_048_576) : 0;
    send("on-game-transfer-progress", shop, objectId, progress, {
      speed: Math.max(0, speedMBps),
      eta: Math.ceil(etaSeconds),
      transferred: bytesCopied,
      total: totalSize,
    });
  };

  // Copy a single file with a stream (handles Large files gracefully)
  const copyFile = async (srcFile: string, destFile: string): Promise<void> => {
    const state = activeTransfers.get(id);
    if (!state || state.cancelled) throw new Error("cancelled");
    while (state.paused) await new Promise(r => setTimeout(r, 100));
    if (state.cancelled) throw new Error("cancelled");

    await fs.mkdir(path.dirname(destFile), { recursive: true });
    const stat = await fs.stat(srcFile);
    const fileSize = stat.size;

    await pipeline(
      createReadStream(srcFile),
      createWriteStream(destFile)
    );

    bytesCopied += fileSize;
    notifyProgress();
  };

  const runWithLimit = async (queue: (() => Promise<void>)[]) => {
    const results: Promise<void>[] = [];
    for (const task of queue) {
      const promise = task();
      results.push(promise);
      if (results.length >= CONCURRENCY) {
        await Promise.race(results);
        results.splice(
          results.findIndex(p => p === promise),
          1
        );
      }
    }
    await Promise.all(results);
  };

  // Collect all files
  const tasks: (() => Promise<void>)[] = [];
  const walk = async (currentSrc: string, currentDest: string) => {
    const entries = await fs.readdir(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(currentSrc, entry.name);
      const destPath = path.join(currentDest, entry.name);
      if (entry.isDirectory()) {
        await walk(srcPath, destPath);
      } else if (entry.isFile()) {
        tasks.push(() => copyFile(srcPath, destPath));
      }
    }
  };
  await walk(src, dest);
  await runWithLimit(tasks);

  // Final copy for directories (timestamps, etc.) – we don't need to, but we can
  // Preserve directory timestamps after all files are done.
  const walkDirs = async (s: string, d: string) => {
    const entries = await fs.readdir(s, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        const sp = path.join(s, e.name);
        const dp = path.join(d, e.name);
        await fs.mkdir(dp, { recursive: true });
        const stat = await fs.stat(sp);
        await fs.utimes(dp, stat.atime, stat.mtime);
        await walkDirs(sp, dp);
      }
    }
  };
  await walkDirs(src, dest);
}

// ── MAIN TRANSFER EVENT ──────────────────────────────────────────────────────
registerEvent(
  "transferGameFiles",
  async (_event, shop: GameShop, objectId: string, destParent: string) => {
    const id = `${shop}:${objectId}`;
    activeTransfers.set(id, { paused: false, cancelled: false });

    send("on-game-transfer-progress", shop, objectId, 0, {
      speed: 0, eta: 0, transferred: 0, total: 0,
    });

    const gameKey = levelKeys.game(shop, objectId);

    let game;
    try { game = await gamesSublevel.get(gameKey); }
    catch { activeTransfers.delete(id); return { ok: false, error: "Game not found" }; }

    if (!game?.executablePath) {
      activeTransfers.delete(id); return { ok: false, error: "No executable selected" };
    }

    const exePath = game.executablePath;
    const gameRoot = await findGameRootFromExe(exePath).catch(() => null);
    if (!gameRoot) {
      activeTransfers.delete(id); return { ok: false, error: "Cannot determine game root folder" };
    }

    const folderName = path.basename(gameRoot);
    const targetRoot = path.join(destParent, folderName);

    if (path.resolve(gameRoot) === path.resolve(targetRoot)) {
      activeTransfers.delete(id); return { ok: false, error: "Game is already in this location" };
    }
    if (targetRoot.startsWith(gameRoot + path.sep)) {
      activeTransfers.delete(id); return { ok: false, error: "Destination is inside source folder" };
    }

    const gameSize = await getDirectorySize(gameRoot);
    const isSameDrive = sameDrive(gameRoot, destParent);

    // ── Free space check (cross‑drive only) ────────────────────────────────
    if (!isSameDrive) {
      try {
        // Node ≥ 18.15 has fs.statfs
        if (typeof fs.statfs === "function") {
          const stats = await fs.statfs(destParent);
          const available = stats.bfree * stats.bsize;
          if (available < gameSize) {
            activeTransfers.delete(id);
            return {
              ok: false,
              error: "not_enough_space",
              needed: gameSize,
              available,
            };
          }
        } else {
          // Fallback to WMIC only on Windows
          if (process.platform === "win32") {
            const { execSync } = await import("node:child_process");
            const drive = path.parse(destParent).root.replace(/\\/g, "").replace(":", "");
            const out = execSync(
              `wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /format:value`,
              { encoding: "utf8" }
            );
            const match = out.match(/FreeSpace=(\d+)/);
            if (match && parseInt(match[1]) < gameSize) {
              activeTransfers.delete(id);
              return {
                ok: false,
                error: "not_enough_space",
                needed: gameSize,
                available: parseInt(match[1]),
              };
            }
          }
        }
      } catch {
        // Proceed without check if tooling fails
      }
    }

    await fs.mkdir(destParent, { recursive: true });

    const startTime = Date.now();

    try {
      if (isSameDrive) {
        // ── Instant rename ──────────────────────────────────────────────────
        await fs.rename(gameRoot, targetRoot);
        // Progress: 100% immediately
        send("on-game-transfer-progress", shop, objectId, 1, {
          speed: 0,
          eta: 0,
          transferred: gameSize,
          total: gameSize,
        });
      } else {
        // ── Cross‑drive copy with per‑file progress ────────────────────────
        await copyDirectoryWithProgress(
          gameRoot,
          targetRoot,
          gameSize,
          id,
          shop,
          objectId,
          startTime
        );
        // Remove source after successful copy
        await fs.rm(gameRoot, { recursive: true, force: true }).catch(() => {});

        // Send final 100% progress
        send("on-game-transfer-progress", shop, objectId, 1, {
          speed: 0,
          eta: 0,
          transferred: gameSize,
          total: gameSize,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      // Clean up partial destination
      await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => {});
      activeTransfers.delete(id);
      if (msg === "cancelled") {
        send("on-game-transfer-cancelled", shop, objectId);
        return { ok: false, error: "Transfer cancelled" };
      }
      send("on-game-transfer-error", shop, objectId, msg);
      return { ok: false, error: msg };
    }

    // ── Update database paths ──────────────────────────────────────────────
    const relExe = path.relative(gameRoot, exePath);
    const newExePath = path.join(targetRoot, relExe);
    const installedSizeInBytes = isSameDrive
      ? (game.installedSizeInBytes ?? gameSize)
      : gameSize;

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

    activeTransfers.delete(id);
    send("on-game-transfer-complete", shop, objectId, newExePath);
    return { ok: true, newExePath };
  }
);

// ── PAUSE / RESUME / CANCEL ──────────────────────────────────────────────────
registerEvent("pauseGameTransfer", async (_e, shop: GameShop, objectId: string) => {
  const s = activeTransfers.get(`${shop}:${objectId}`);
  if (s) s.paused = true;
});

registerEvent("resumeGameTransfer", async (_e, shop: GameShop, objectId: string) => {
  const s = activeTransfers.get(`${shop}:${objectId}`);
  if (s) s.paused = false;
});

registerEvent("cancelGameTransfer", async (_e, shop: GameShop, objectId: string) => {
  const s = activeTransfers.get(`${shop}:${objectId}`);
  if (s) {
    s.cancelled = true;
    s.paused = false;
  }
});
