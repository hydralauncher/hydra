import path from "node:path";
import fs from "node:fs/promises";
import { registerEvent } from "./register-event";
import { gamesSublevel, downloadsSublevel, levelKeys } from "@main/level";
import { findGameRootFromExe } from "./helpers/find-game-root";
import { getDirectorySize } from "./helpers/get-directory-size";
import { WindowManager } from "@main/services/window-manager";
import { GameMover } from "@main/services/move-engine";
import type { GameShop } from "@types";

function send(
  event: string,
  shop: GameShop,
  objectId: string,
  ...args: unknown[]
) {
  WindowManager.mainWindow?.webContents.send(event, shop, objectId, ...args);
}

const activeTransfers = new Map<string, GameMover>();

registerEvent(
  "transferGameFiles",
  async (_event, shop: GameShop, objectId: string, destParent: string) => {
    const id = `${shop}:${objectId}`;

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
      return { ok: false, error: "Game not found" };
    }

    if (!game?.executablePath) {
      return { ok: false, error: "No executable selected" };
    }

    const exePath = game.executablePath;
    const gameRoot = await findGameRootFromExe(exePath).catch(() => null);
    if (!gameRoot) {
      return { ok: false, error: "Cannot determine game root folder" };
    }

    const folderName = path.basename(gameRoot);
    const targetRoot = path.join(destParent, folderName);

    if (path.resolve(gameRoot) === path.resolve(targetRoot)) {
      return { ok: false, error: "Game is already in this location" };
    }
    if (targetRoot.startsWith(gameRoot + path.sep)) {
      return { ok: false, error: "Destination is inside source folder" };
    }

    const gameSize = await getDirectorySize(gameRoot);

    // Space check
    try {
      if (typeof (fs as any).statfs === "function") {
        const stats = await (fs as any).statfs(destParent);
        const available = stats.bfree * stats.bsize;
        if (available < gameSize) {
          return {
            ok: false,
            error: "not_enough_space",
            needed: gameSize,
            available,
          };
        }
      }
    } catch {
      // Proceed without check
    }

    await fs.mkdir(destParent, { recursive: true });

    const mover = new GameMover();
    activeTransfers.set(id, mover);

    mover.on("progress", (data) => {
      send("on-game-transfer-progress", shop, objectId, data.progress, {
        speed: data.speed,
        eta: data.eta,
        transferred: data.transferred,
        total: data.total,
      });
    });

    try {
      await mover.moveFolder(gameRoot, targetRoot);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => {});
      mover.destroy();
      activeTransfers.delete(id);
      if (msg === "cancelled") {
        send("on-game-transfer-cancelled", shop, objectId);
        return { ok: false, error: "Transfer cancelled" };
      }
      send("on-game-transfer-error", shop, objectId, msg);
      return { ok: false, error: msg };
    }

    // Update database
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
      mover.destroy();
      activeTransfers.delete(id);
      return { ok: false, error: "Failed to update database" };
    }

    mover.destroy();
    activeTransfers.delete(id);
    send("on-game-transfer-complete", shop, objectId, newExePath);
    return { ok: true, newExePath };
  }
);

registerEvent(
  "pauseGameTransfer",
  async (_e, shop: GameShop, objectId: string) => {
    const mover = activeTransfers.get(`${shop}:${objectId}`);
    mover?.pause();
  }
);

registerEvent(
  "resumeGameTransfer",
  async (_e, shop: GameShop, objectId: string) => {
    const mover = activeTransfers.get(`${shop}:${objectId}`);
    mover?.resume();
  }
);

registerEvent(
  "cancelGameTransfer",
  async (_e, shop: GameShop, objectId: string) => {
    const mover = activeTransfers.get(`${shop}:${objectId}`);
    mover?.cancel();
  }
);
