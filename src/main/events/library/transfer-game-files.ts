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
  try {
    await fs.rename(src, dest);
  } catch {
    // Cross-drive: copy then delete
    await pipeline(createReadStream(src), createWriteStream(dest));
    await fs.unlink(src);
  }
}

async function moveDir(
  src: string,
  dest: string,
  id: string,
  counter: { value: number },
  total: number,
  lastSent: { ts: number },
  shop: GameShop,
  objectId: string
) {
  await waitIfPaused(id);
  await fs.mkdir(dest, { recursive: true });

  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    await waitIfPaused(id); // re-check on every entry

    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await moveDir(s, d, id, counter, total, lastSent, shop, objectId);
      try {
        await fs.rmdir(s);
      } catch {
        /* not empty yet — rmdir at cleanup */
      }
    } else {
      await moveFile(s, d);
      counter.value++;

      const now = Date.now();
      if (now - lastSent.ts >= THROTTLE_MS) {
        lastSent.ts = now;
        send(
          "on-game-transfer-progress",
          shop,
          objectId,
          counter.value / Math.max(total, 1)
        );
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

// ── TRANSFER ──────────────────────────────────────────────────────────────────
registerEvent(
  "transferGameFiles",
  async (_event, shop: GameShop, objectId: string, destParent: string) => {
    const id = `${shop}:${objectId}`;
    activeTransfers.set(id, { paused: false, cancelled: false });

    const gameKey = levelKeys.game(shop, objectId);

    let game;
    try {
      game = await gamesSublevel.get(gameKey);
    } catch {
      activeTransfers.delete(id);
      return { ok: false, error: "game_not_found" };
    }

    if (!game?.executablePath) {
      activeTransfers.delete(id);
      return { ok: false, error: "no_executable" };
    }

    const exePath = game.executablePath;
    const gameRoot = await findGameRootFromExe(exePath).catch(() => null);
    if (!gameRoot) {
      activeTransfers.delete(id);
      return { ok: false, error: "cannot_determine_root" };
    }

    const folderName = path.basename(gameRoot);
    const targetRoot = path.join(destParent, folderName);

    if (path.resolve(gameRoot) === path.resolve(targetRoot)) {
      activeTransfers.delete(id);
      return { ok: false, error: "same_folder" };
    }
    if (targetRoot.startsWith(gameRoot + path.sep)) {
      activeTransfers.delete(id);
      return { ok: false, error: "dest_inside_source" };
    }

    // Space check
    const gameSize = await getDirectorySize(gameRoot);
    try {
      const { execSync } = await import("node:child_process");
      if (process.platform === "win32") {
        const drive = path.parse(destParent).root.replace(/\\/g, "");
        const out = execSync(
          `wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace /format:value`,
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
    } catch {
      /* proceed if check fails */
    }

    const total = await countFiles(gameRoot);
    const counter = { value: 0 };
    const lastSent = { ts: 0 };

    send("on-game-transfer-progress", shop, objectId, 0);

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
        objectId
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown";

      // Clean up partial destination
      await fs.rm(targetRoot, { recursive: true, force: true }).catch(() => {});

      activeTransfers.delete(id);

      if (msg === "cancelled") {
        send("on-game-transfer-cancelled", shop, objectId);
        return { ok: false, error: "cancelled" };
      }

      send("on-game-transfer-error", shop, objectId, msg);
      return { ok: false, error: msg };
    }

    // 100%
    send("on-game-transfer-progress", shop, objectId, 1);

    // New exe path preserves relative structure (e.g. bin/game.exe)
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
      return { ok: false, error: "db_update_failed" };
    }

    // Delete original source folder
    await fs
      .rm(gameRoot, { recursive: true, force: true })
      .catch((e) => console.error("[transfer] failed to delete source:", e));

    activeTransfers.delete(id);
    send("on-game-transfer-complete", shop, objectId, newExePath);
    return { ok: true, newExePath };
  }
);

// ── PAUSE / RESUME / CANCEL ───────────────────────────────────────────────────
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
