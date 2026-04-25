import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { registerEvent } from "../register-event";
import { gamesSublevel, downloadsSublevel, levelKeys } from "@main/level";
import { findGameRootFromExe } from "../helpers/find-game-root";
import { getDirectorySize } from "../helpers/get-directory-size";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop, LibraryGame } from "@types";

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
    currentStreams: Set<{ destroy(): void }>;
    pendingRejects: Array<(error: Error) => void>;
  }
>();

// ── Steam‑style copy engine ─────────────────────────────────────────────────
class SteamCopyEngine {
  private bytesCopied = 0;
  private readonly totalSize: number;
  private readonly startTime: number;
  private lastReportTime = 0;
  private readonly REPORT_INTERVAL = 100;
  private readonly BLOCK_SIZE = 1024 * 1024;
  private readonly CONCURRENCY = 8; //4 default - 8 performance/faster

  constructor(
    private readonly id: string,
    private readonly shop: GameShop,
    private readonly objectId: string,
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
      await this.checkCancelled();

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
      await this.checkCancelled();

      const srcPath = path.join(srcDir, dir.name);
      const destPath = path.join(destDir, dir.name);
      await fs.mkdir(destPath, { recursive: true });
      await this.copyDirectory(srcPath, destPath);
    }
  }

  private async checkCancelled(): Promise<void> {
    const state = activeTransfers.get(this.id);
    if (state?.cancelled) throw new Error("cancelled");
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

      state.pendingRejects.push(reject);

      const readStream = createReadStream(srcFile, {
        highWaterMark: this.BLOCK_SIZE,
      });
      const writeStream = createWriteStream(destFile);

      const streamRef = {
        destroy() {
          readStream.destroy();
          writeStream.destroy();
        },
      };
      state.currentStreams.add(streamRef);

      const cleanup = () => {
        const idx = state.pendingRejects.indexOf(reject);
        if (idx !== -1) state.pendingRejects.splice(idx, 1);
        state.currentStreams.delete(streamRef);
      };

      readStream.on("data", (chunk: string | Buffer) => {
        this.addBytes(Buffer.byteLength(chunk));
      });

      readStream.on("close", () => {
        if (!state.cancelled) return;
        cleanup();
        reject(new Error("cancelled"));
      });

      readStream.on("error", (err) => {
        cleanup();
        reject(err);
      });
      writeStream.on("error", (err) => {
        cleanup();
        reject(err);
      });
      writeStream.on("finish", () => {
        cleanup();
        resolve();
      });

      readStream.pipe(writeStream);
    });
  }
}

// ── Helper functions for transfer validation ────────────────────────────────
interface GameWithExecutable extends LibraryGame {
  executablePath: string;
}

async function validateGameExists(
  shop: GameShop,
  objectId: string
): Promise<GameWithExecutable | null> {
  const gameKey = levelKeys.game(shop, objectId);
  try {
    const game = (await gamesSublevel.get(gameKey)) as LibraryGame | undefined;
    if (game?.executablePath) {
      return game as GameWithExecutable;
    }
    return null;
  } catch {
    return null;
  }
}

async function validateGameRoot(
  game: GameWithExecutable
): Promise<
  { valid: true; gameRoot: string } | { valid: false; error: string }
> {
  const gameRoot = await findGameRootFromExe(game.executablePath).catch(
    () => null
  );
  if (!gameRoot) {
    return { valid: false, error: "Cannot determine game root folder" };
  }

  return { valid: true, gameRoot };
}

async function validateDestination(
  gameRoot: string,
  _destParent: string,
  targetRoot: string
) {
  if (path.resolve(gameRoot) === path.resolve(targetRoot)) {
    return { valid: false, error: "Game is already in this location" };
  }

  if (targetRoot.startsWith(gameRoot + path.sep)) {
    return { valid: false, error: "Destination is inside source folder" };
  }

  return { valid: true };
}

async function checkDiskSpace(destParent: string, requiredSize: number) {
  try {
    if (typeof (fs as any).statfs === "function") {
      const stats = await (fs as any).statfs(destParent);
      const available = stats.bfree * stats.bsize;
      if (available < requiredSize) {
        return {
          hasSpace: false,
          error: "not_enough_space" as const,
          needed: requiredSize,
          available,
        };
      }
    }
  } catch {
    // Proceed without check if unavailable
  }

  return { hasSpace: true };
}

async function updateDatabaseAfterTransfer(
  game: GameWithExecutable,
  gameKey: string,
  newExePath: string,
  gameSize: number
) {
  const installedSizeInBytes = game.installedSizeInBytes ?? gameSize;

  await gamesSublevel.put(gameKey, {
    ...game,
    executablePath: newExePath,
    installedSizeInBytes,
  });

  const download = await downloadsSublevel.get(gameKey).catch(() => null);
  if (download) {
    await downloadsSublevel.put(gameKey, {
      ...download,
      downloadPath: path.dirname(newExePath),
      folderName: path.basename(path.dirname(newExePath)),
    });
  }
}

async function cleanupOnError(id: string, targetRoot: string) {
  await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => {});
  activeTransfers.delete(id);
}

// ── MAIN TRANSFER EVENT ─────────────────────────────────────────────────────
registerEvent(
  "transferGameFiles",
  async (_event, shop: GameShop, objectId: string, destParent: string) => {
    const id = `${shop}:${objectId}`;
    activeTransfers.set(id, {
      cancelled: false,
      currentStreams: new Set(),
      pendingRejects: [],
    });

    // Validate game exists and has executable path
    const game = await validateGameExists(shop, objectId);
    if (!game) {
      activeTransfers.delete(id);
      return { ok: false, error: "Game not found or has no executable path" };
    }

    // Validate game root
    const rootValidation = await validateGameRoot(game);
    if (!rootValidation.valid) {
      activeTransfers.delete(id);
      return { ok: false, error: rootValidation.error };
    }
    const gameRoot: string = rootValidation.gameRoot;

    const folderName = path.basename(gameRoot);
    const targetRoot = path.join(destParent, folderName);

    // Validate destination
    const destValidation = await validateDestination(
      gameRoot,
      destParent,
      targetRoot
    );
    if (!destValidation.valid) {
      activeTransfers.delete(id);
      return { ok: false, error: destValidation.error };
    }

    // Send initial progress
    send("on-game-transfer-progress", shop, objectId, 0, {
      speed: 0,
      eta: 0,
      transferred: 0,
      total: 0,
    });

    const gameSize = await getDirectorySize(gameRoot);

    // Check disk space
    const spaceCheck = await checkDiskSpace(destParent, gameSize);
    if (!spaceCheck.hasSpace) {
      activeTransfers.delete(id);
      return {
        ok: false,
        error: spaceCheck.error,
        needed: spaceCheck.needed,
        available: spaceCheck.available,
      };
    }

    await fs.mkdir(destParent, { recursive: true });

    const engine = new SteamCopyEngine(id, shop, objectId, gameSize);

    try {
      await engine.moveGame(gameRoot, targetRoot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await cleanupOnError(id, targetRoot);

      if (msg === "cancelled") {
        send("on-game-transfer-cancelled", shop, objectId);
        return { ok: false, error: "Transfer cancelled" };
      }

      send("on-game-transfer-error", shop, objectId, msg);
      return { ok: false, error: msg };
    }

    const relExe = path.relative(gameRoot, game.executablePath);
    const newExePath = path.join(targetRoot, relExe);
    const gameKey = levelKeys.game(shop, objectId);

    try {
      await updateDatabaseAfterTransfer(game, gameKey, newExePath, gameSize);
    } catch {
      await cleanupOnError(id, targetRoot);
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
      s.currentStreams.forEach((stream) => stream.destroy());
      s.currentStreams.clear();
      s.pendingRejects.forEach((reject) => reject(new Error("cancelled")));
      s.pendingRejects = [];
    }
  }
);
