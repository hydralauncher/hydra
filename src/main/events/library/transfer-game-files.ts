import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { registerEvent } from "../register-event";
import { gamesSublevel, downloadsSublevel, levelKeys } from "@main/level";
import { findGameRootFromExe } from "../helpers/find-game-root";
import { getDirectorySize } from "../helpers/get-directory-size";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop } from "@types";

// ── Helpers ─────────────────────────────────────────────────────────────────
function send(
  event: string,
  shop: GameShop,
  objectId: string,
  ...args: unknown[]
) {
  WindowManager.mainWindow?.webContents.send(event, shop, objectId, ...args);
}

// ── State ───────────────────────────────────────────────────────────────────
const activeTransfers = new Map<
  string,
  {
    cancelled: boolean;
    currentStream?: { destroy(): void };
  }
>();

// ── Steam‑style copy engine ─────────────────────────────────────────────────
class SteamCopyEngine {
  private bytesCopied = 0;
  private totalSize: number;
  private startTime: number;
  private lastReportTime = 0;
  private readonly REPORT_INTERVAL = 100;
  private readonly BLOCK_SIZE = 1024 * 1024;
  private readonly CONCURRENCY = 4;

  constructor(
    private id: string,
    private shop: GameShop,
    private objectId: string,
    totalSize: number
  ) {
    this.totalSize = totalSize;
    this.startTime = Date.now();
  }

  private reportProgress() {
    const now = Date.now();
    if (now - this.lastReportTime < this.REPORT_INTERVAL) return;
    this.lastReportTime = now;

    const elapsedSec = (now - this.startTime) / 1000;
    const speedMBps =
      elapsedSec > 0 ? this.bytesCopied / elapsedSec / 1_048_576 : 0;
    const remaining = this.totalSize - this.bytesCopied;
    const etaSeconds = speedMBps > 0 ? remaining / (speedMBps * 1_048_576) : 0;
    const progress = this.bytesCopied / Math.max(this.totalSize, 1);

    send("on-game-transfer-progress", this.shop, this.objectId, progress, {
      speed: Math.max(0, speedMBps),
      eta: Math.ceil(etaSeconds),
      transferred: this.bytesCopied,
      total: this.totalSize,
    });
  }

  private addBytes(bytes: number) {
    this.bytesCopied += bytes;
    this.reportProgress();
  }

  async moveGame(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    await this.copyDirectory(src, dest);
    await fs.rm(src, { recursive: true, force: true }).catch(() => {});
  }

  private async copyDirectory(srcDir: string, destDir: string): Promise<void> {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });

    const files = entries.filter((e) => e.isFile());
    const dirs = entries.filter((e) => e.isDirectory());

    for (let i = 0; i < files.length; i += this.CONCURRENCY) {
      const batch = files.slice(i, i + this.CONCURRENCY);
      await Promise.all(
        batch.map((file) =>
          this.copyFileWithProgress(
            path.join(srcDir, file.name),
            path.join(destDir, file.name)
          )
        )
      );
    }

    for (const dir of dirs) {
      const srcPath = path.join(srcDir, dir.name);
      const destPath = path.join(destDir, dir.name);
      await fs.mkdir(destPath, { recursive: true });
      await this.copyDirectory(srcPath, destPath);
    }
  }

  private copyFileWithProgress(
    srcFile: string,
    destFile: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const state = activeTransfers.get(this.id);

      if (!state || state.cancelled) {
        return reject(new Error("cancelled"));
      }

      const readStream = createReadStream(srcFile, {
        highWaterMark: this.BLOCK_SIZE,
      });
      const writeStream = createWriteStream(destFile);

      if (state) {
        state.currentStream = {
          destroy() {
            readStream.destroy();
            writeStream.destroy();
          },
        };
      }

      readStream.on("data", (chunk: string | Buffer) => {
        this.addBytes(Buffer.byteLength(chunk));
      });

      readStream.on("error", reject);
      writeStream.on("error", reject);
      writeStream.on("finish", resolve);

      readStream.pipe(writeStream);
    });
  }
}

// ── MAIN TRANSFER EVENT ─────────────────────────────────────────────────────
registerEvent(
  "transferGameFiles",
  async (_event, shop: GameShop, objectId: string, destParent: string) => {
    const id = `${shop}:${objectId}`;
    activeTransfers.set(id, { cancelled: false });

    send("on-game-transfer-progress", shop, objectId, 0, {
      speed: 0,
      eta: 0,
      transferred: 0,
      total: 0,
    });

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

    if (path.resolve(gameRoot) === path.resolve(targetRoot)) {
      activeTransfers.delete(id);
      return { ok: false, error: "Game is already in this location" };
    }
    if (targetRoot.startsWith(gameRoot + path.sep)) {
      activeTransfers.delete(id);
      return { ok: false, error: "Destination is inside source folder" };
    }

    const gameSize = await getDirectorySize(gameRoot);

    try {
      if (typeof (fs as any).statfs === "function") {
        const stats = await (fs as any).statfs(destParent);
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
      }
    } catch {
      // Proceed without check if unavailable
    }

    await fs.mkdir(destParent, { recursive: true });

    const engine = new SteamCopyEngine(id, shop, objectId, gameSize);

    try {
      await engine.moveGame(gameRoot, targetRoot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => {});
      activeTransfers.delete(id);
      if (msg === "cancelled") {
        send("on-game-transfer-cancelled", shop, objectId);
        return { ok: false, error: "Transfer cancelled" };
      }
      send("on-game-transfer-error", shop, objectId, msg);
      return { ok: false, error: msg };
    }

    const relExe = path.relative(gameRoot, exePath);
    const newExePath = path.join(targetRoot, relExe);
    const installedSizeInBytes = game.installedSizeInBytes ?? gameSize;

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

// ── CANCEL ────────────────────────────────────────────────────────────────────
registerEvent(
  "cancelGameTransfer",
  async (_e, shop: GameShop, objectId: string) => {
    const s = activeTransfers.get(`${shop}:${objectId}`);
    if (s) {
      s.cancelled = true;
      s.currentStream?.destroy();
    }
  }
  
);

