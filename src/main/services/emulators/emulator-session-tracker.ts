import type { ChildProcess } from "node:child_process";
import fs from "node:fs";

import { gamesSublevel, levelKeys } from "@main/level";
import type { EmulatorSystem, Game, GameShop } from "@types";

import { trackGamePlaytime } from "../library-sync";
import { logger } from "../logger";
import { publishAchievementUnlockNotification } from "../notifications";
import { syncRetroAchievements } from "../retro-achievements/retro-achievements-sync";
import { WindowManager } from "../window-manager";
import { readEmulatorPlaytimeSeconds } from "./playtime-files";
import {
  getRpcs3UnlockedTrophyIds,
  isLaunchboxRpcs3Game,
  readRpcs3TrophyState,
  saveRpcs3TrophyState,
} from "./rpcs3-trophies";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";

export interface EmulatorSession {
  shop: GameShop;
  objectId: string;
  system: EmulatorSystem;
  executablePath: string;
  sku: string | null;
  beforeTotalSeconds: number | null;
  startedAt: number;
  heartbeat: ReturnType<typeof setInterval> | null;
  child: ChildProcess;
  rpcs3TrophyDatPath?: string | null;
  rpcs3ProcessedUnlocks?: Set<number>;
}

export const emulatorSessions = new Map<string, EmulatorSession>();

const PRESENCE_HEARTBEAT_INTERVAL_MS = 60_000;

const sendPresencePing = async (gameKey: string): Promise<void> => {
  const game = await gamesSublevel.get(gameKey);
  if (!game || game.shop === "custom") return;

  await trackGamePlaytime(game, 0, new Date()).catch((error) => {
    logger.error("Failed to send emulator presence ping", error);
  });
};

const syncRpcs3TrophyState = async (
  game: Game,
  gameKey: string,
  executablePath: string,
  session: EmulatorSession,
  notifyOnNewUnlocks: boolean
): Promise<boolean> => {
  logger.log("syncRpcs3TrophyState called", {
    gameKey,
    title: game.title,
    executablePath,
    notifyOnNewUnlocks,
    previousProcessedUnlocks: session.rpcs3ProcessedUnlocks?.size ?? 0,
  });

  logger.log("syncRpcs3TrophyState reading RPCS3 trophy state", {
    title: game.title,
    executablePath,
  });

  const trophyState = await readRpcs3TrophyState(executablePath, game.title);
  if (!trophyState) {
    logger.log("syncRpcs3TrophyState found no RPCS3 trophy state", {
      title: game.title,
      executablePath,
    });
    return false;
  }

  logger.log("syncRpcs3TrophyState received RPCS3 trophy state", {
    title: game.title,
    totalAchievements: trophyState.achievements.length,
    unlockedAchievements: trophyState.unlockedAchievements.length,
  });

  const unlockedTrophies = getRpcs3UnlockedTrophyIds(
    trophyState.trophyPaths.datFilePath
  );
  logger.log("syncRpcs3TrophyState loaded unlocked trophy IDs", {
    title: game.title,
    datFilePath: trophyState.trophyPaths.datFilePath,
    unlockedCount: unlockedTrophies.size,
  });

  const previousUnlocks = session.rpcs3ProcessedUnlocks ?? new Set<number>();
  const newlyUnlocked = trophyState.achievements.filter((achievement) => {
    const trophyId = Number.parseInt(achievement.name, 10);
    return (
      Number.isFinite(trophyId) &&
      unlockedTrophies.has(trophyId) &&
      !previousUnlocks.has(trophyId)
    );
  });

  session.rpcs3ProcessedUnlocks = new Set(unlockedTrophies.keys());
  session.rpcs3TrophyDatPath = trophyState.trophyPaths.datFilePath;

  logger.log("syncRpcs3TrophyState saving RPCS3 trophy state", {
    gameKey,
    title: game.title,
    datFilePath: trophyState.trophyPaths.datFilePath,
  });

  await saveRpcs3TrophyState(gameKey, trophyState);

  if (notifyOnNewUnlocks && newlyUnlocked.length) {
    logger.log("syncRpcs3TrophyState sending RPCS3 unlock notification", {
      title: game.title,
      newlyUnlockedCount: newlyUnlocked.length,
      unlockedCount: unlockedTrophies.size,
    });

    await publishAchievementUnlockNotification({
      achievements: newlyUnlocked.map((achievement) => ({
        title: achievement.displayName,
        description: achievement.description,
        iconUrl: achievement.icon,
        isHidden: achievement.hidden,
        isRare: false,
        isPlatinum: /platinum/i.test(achievement.displayName),
      })),
      unlockedAchievementCount: unlockedTrophies.size,
      totalAchievementCount: trophyState.achievements.length,
      gameTitle: game.title,
      gameIcon: game.iconUrl,
    });
  }

  logger.log("syncRpcs3TrophyState completed", {
    title: game.title,
    newlyUnlockedCount: newlyUnlocked.length,
    unlockedCount: unlockedTrophies.size,
  });

  return true;
};

interface StartEmulatorSessionOptions {
  game: Game;
  system: EmulatorSystem;
  executablePath: string;
  sku: string | null;
  child: ChildProcess;
}

export const startEmulatorSession = async ({
  game,
  system,
  executablePath,
  sku,
  child,
}: StartEmulatorSessionOptions): Promise<void> => {
  const gameKey = levelKeys.game(game.shop, game.objectId);

  const before = sku
    ? await readEmulatorPlaytimeSeconds(system, executablePath, sku)
    : null;

  const session: EmulatorSession = {
    shop: game.shop,
    objectId: game.objectId,
    system,
    executablePath,
    sku,
    beforeTotalSeconds: before,
    startedAt: performance.now(),
    heartbeat: null,
    child,
  };

  emulatorSessions.set(gameKey, session);

  logger.log("startEmulatorSession created session", {
    gameKey,
    title: game.title,
    shop: game.shop,
    system,
    executablePath,
  });

  logger.log("startEmulatorSession checking RPCS3 eligibility", {
    gameKey,
    title: game.title,
    shop: game.shop,
  });

  if (await isLaunchboxRpcs3Game(game.shop, game.objectId)) {
    logger.log("startEmulatorSession entering RPCS3 tracking path", {
      gameKey,
      title: game.title,
      executablePath,
    });

    const synced = await syncRpcs3TrophyState(
      game,
      gameKey,
      executablePath,
      session,
      false
    );

    logger.log("startEmulatorSession initial RPCS3 sync result", {
      gameKey,
      title: game.title,
      synced,
      rpcs3TrophyDatPath: session.rpcs3TrophyDatPath,
    });

    if (synced && session.rpcs3TrophyDatPath) {
      logger.log("startEmulatorSession watching RPCS3 trophy DAT", {
        gameKey,
        title: game.title,
        rpcs3TrophyDatPath: session.rpcs3TrophyDatPath,
      });

      fs.watchFile(session.rpcs3TrophyDatPath, { interval: 1000 }, () => {
        logger.log("startEmulatorSession detected RPCS3 trophy DAT change", {
          gameKey,
          title: game.title,
          rpcs3TrophyDatPath: session.rpcs3TrophyDatPath,
        });

        void syncRpcs3TrophyState(game, gameKey, executablePath, session, true)
          .then(() =>
            getUnlockedAchievements(game.objectId, game.shop, true).then(
              (gameAchievements) => {
                logger.log(
                  "startEmulatorSession publishing updated RPCS3 achievements",
                  {
                    gameKey,
                    title: game.title,
                    achievementCount: gameAchievements.length,
                  }
                );

                WindowManager.mainWindow?.webContents.send(
                  `on-update-achievements-${game.objectId}-${game.shop}`,
                  gameAchievements
                );
              }
            )
          )
          .catch((error) => {
            logger.error("Failed to sync RPCS3 trophy progress", error);
          });
      });
    } else {
      logger.log("startEmulatorSession did not start RPCS3 DAT watcher", {
        gameKey,
        title: game.title,
        synced,
        rpcs3TrophyDatPath: session.rpcs3TrophyDatPath,
      });
    }
  } else {
    logger.log("startEmulatorSession not an RPCS3 game", {
      gameKey,
      title: game.title,
      shop: game.shop,
    });
  }

  if (game.shop !== "custom") {
    void sendPresencePing(gameKey);
    session.heartbeat = setInterval(() => {
      void sendPresencePing(gameKey);
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    session.heartbeat.unref?.();
  }

  const finalize = () => {
    if (!emulatorSessions.has(gameKey)) return;
    void finalizeEmulatorSession(gameKey);
  };

  child.once("exit", finalize);
  child.once("error", finalize);

  if (child.exitCode !== null || child.signalCode !== null) {
    finalize();
  }
};

export const closeEmulatorSession = (gameKey: string): boolean => {
  const session = emulatorSessions.get(gameKey);
  if (!session) return false;

  const { pid } = session.child;

  try {
    if (pid && process.platform !== "win32") {
      process.kill(-pid, "SIGKILL");
    } else {
      session.child.kill();
    }
  } catch {
    try {
      session.child.kill();
    } catch (error) {
      logger.error("Failed to close emulator session", error);
      return false;
    }
  }

  return true;
};

const finalizeEmulatorSession = async (gameKey: string): Promise<void> => {
  const session = emulatorSessions.get(gameKey);
  if (!session) return;
  emulatorSessions.delete(gameKey);
  if (session.heartbeat) clearInterval(session.heartbeat);
  if (session.rpcs3TrophyDatPath) {
    fs.unwatchFile(session.rpcs3TrophyDatPath);
  }

  const game = await gamesSublevel.get(gameKey);
  if (!game) return;

  let deltaSeconds = 0;
  if (session.sku) {
    const after = await readEmulatorPlaytimeSeconds(
      session.system,
      session.executablePath,
      session.sku
    );
    const before = session.beforeTotalSeconds;
    if (after !== null && before === null && after > 0) {
      deltaSeconds = after;
    } else if (after !== null && before !== null && after > before) {
      deltaSeconds = after - before;
    }
  }

  if (deltaSeconds <= 0) {
    deltaSeconds = Math.max(0, (performance.now() - session.startedAt) / 1000);
  }

  const deltaMs = deltaSeconds * 1000;
  const updated: Game = {
    ...game,
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + deltaMs,
    lastTimePlayed: new Date(),
  };

  await gamesSublevel.put(gameKey, updated);

  if (game.shop === "custom") return;

  const pendingDelta =
    deltaMs + (game.unsyncedDeltaPlayTimeInMilliseconds ?? 0);

  trackGamePlaytime(updated, pendingDelta, updated.lastTimePlayed!)
    .then(() =>
      gamesSublevel.put(gameKey, {
        ...updated,
        unsyncedDeltaPlayTimeInMilliseconds: 0,
      })
    )
    .catch((error) => {
      logger.error("Failed to sync emulator playtime", error);
      return gamesSublevel.put(gameKey, {
        ...updated,
        unsyncedDeltaPlayTimeInMilliseconds: pendingDelta,
      });
    });

  if (await isLaunchboxRpcs3Game(game.shop, game.objectId)) {
    logger.log("finalizeEmulatorSession entering RPCS3 finalize path", {
      gameKey,
      title: game.title,
      rpcs3TrophyDatPath: session.rpcs3TrophyDatPath,
    });

    if (session.rpcs3TrophyDatPath) {
      logger.log(
        "finalizeEmulatorSession syncing RPCS3 trophy state before exit",
        {
          gameKey,
          title: game.title,
          rpcs3TrophyDatPath: session.rpcs3TrophyDatPath,
        }
      );

      await syncRpcs3TrophyState(
        game,
        gameKey,
        session.executablePath,
        session,
        false
      );

      const gameAchievements = await getUnlockedAchievements(
        game.objectId,
        game.shop,
        true
      );

      logger.log("finalizeEmulatorSession publishing RPCS3 achievements", {
        gameKey,
        title: game.title,
        achievementCount: gameAchievements.length,
      });

      WindowManager.mainWindow?.webContents.send(
        `on-update-achievements-${game.objectId}-${game.shop}`,
        gameAchievements
      );
    } else {
      logger.log("finalizeEmulatorSession has no RPCS3 DAT path to sync", {
        gameKey,
        title: game.title,
      });
    }

    return;
  }

  logger.log("finalizeEmulatorSession using non-RPCS3 finalize path", {
    gameKey,
    title: game.title,
    shop: game.shop,
  });

  if (game.shop === "launchbox") {
    syncRetroAchievements({
      objectId: game.objectId,
      shop: game.shop,
    })
      .then((result) => {
        if (!result.didChange) return;

        WindowManager.mainWindow?.webContents.send(
          `on-update-achievements-${game.objectId}-${game.shop}`,
          result.achievements
        );
      })
      .catch((error) => {
        logger.error("Failed to sync RetroAchievements on session end", error);
      });
  }
};
