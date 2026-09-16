import { WindowManager } from "./window-manager";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { createGame, trackGamePlaytime } from "./library-sync";
import type { Game, GameRunning, UserPreferences } from "@types";
import axios from "axios";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { CloudSync } from "./cloud-sync";
import { logger, networkLogger } from "./logger";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import path from "node:path";
import fs from "node:fs/promises";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { abortAchievementMetadataExport } from "./achievements/metadata-export";
import { INTERVALS } from "@main/constants";
import { Wine } from "./wine";
import { NativeAddon } from "./native-addon";
import { emulatorSessions } from "./emulators/emulator-session-tracker";
import { launchedGamePids } from "./launched-game-pids";
import { isValidProcessWatcherScan } from "./process-watcher-scan";
import {
  doesSteamCompatDataPathMatchWinePrefix,
  hasLaunchedPidMatch,
  hasLinuxNativeOrAppImageMatch,
  type LinuxProcessInfo,
} from "./linux-process-match";
import { isWindowsBatchFile } from "@main/helpers/windows-batch-command";
import { HydraApi } from "./hydra-api";
import { getSteamLibraryFolders } from "./steam";
import {
  isSteamLibraryExecutablePath,
  resolveActiveSteamImport,
  resolveSteamSessionPlaytimePolicy,
} from "./steam-integration/steam-playtime";
import {
  cancelSteamGameExitSync,
  scheduleSteamGameExitSync,
  shouldScheduleSteamGameExitSync,
} from "./steam-integration/steam-game-exit-sync";
import {
  getCloudSaveAutomaticSyncMode,
  runAutomaticCloudSavePostExit,
  shouldRunLegacyAutomaticCloudSave,
  shouldRunV2AutomaticCloudSave,
} from "./cloud-save";
import {
  clearGamesPlaytimeState,
  deleteGamePlaytime,
  gamesPlaytime,
  getGamePlaytimeDeltas,
  setGamePlaytime,
} from "./game-running-state";
import {
  prepareLinuxGameCaptureSession,
  stopLinuxGameCaptureSession,
} from "./linux-game-capture-session";
import { updateGameRecord } from "./game-record-updater";

export { gamesPlaytime };
export { isGameRunning } from "./game-running-state";

const runAutomaticCloudSaveOnOpen = async (game: Game) => {
  const mode = await getCloudSaveAutomaticSyncMode(game.objectId, game.shop);

  if (shouldRunLegacyAutomaticCloudSave(mode)) {
    await CloudSync.uploadSaveGame(
      game.objectId,
      game.shop,
      null,
      CloudSync.getBackupLabel(true)
    );
  }
};

const runAutomaticCloudSaveOnClose = async (game: Game) => {
  const mode = await getCloudSaveAutomaticSyncMode(game.objectId, game.shop);

  if (shouldRunLegacyAutomaticCloudSave(mode)) {
    if (game.remoteId) {
      await CloudSync.uploadSaveGame(
        game.objectId,
        game.shop,
        null,
        CloudSync.getBackupLabel(true)
      );
    }
    return;
  }

  if (shouldRunV2AutomaticCloudSave(mode)) {
    await runAutomaticCloudSavePostExit(game.objectId, game.shop);
  }
};

const handleAutomaticCloudSaveLifecycleError = (
  phase: "open" | "close",
  game: Game,
  error: unknown
) => {
  logger.error("[Cloud Save] Automatic lifecycle failed", {
    phase,
    shop: game.shop,
    objectId: game.objectId,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  });
};

export const getGamesRunning = () => {
  const now = performance.now();
  const gamesRunning = Array.from(gamesPlaytime.entries()).map((entry) => {
    return {
      id: entry[0],
      sessionDurationInMillis: now - entry[1].firstTick,
    } as Pick<GameRunning, "id" | "sessionDurationInMillis">;
  });

  for (const [gameKey, session] of emulatorSessions) {
    gamesRunning.push({
      id: gameKey,
      sessionDurationInMillis: now - session.startedAt,
    });
  }

  return gamesRunning;
};

interface ExecutableInfo {
  name: string;
  os: string;
  exe: string;
}

interface GameExecutables {
  [key: string]: ExecutableInfo[];
}

const TICKS_TO_UPDATE_API = (3 * 60 * 1000) / INTERVALS.processWatcher; // 3 minutes
let currentTick = 1;

const platform = process.platform;

const logPlaytimeTrace = (
  event: string,
  game: Game,
  payload?: Record<string, unknown>
) => {
  networkLogger.info("[playtime-trace]", event, {
    gameKey: levelKeys.game(game.shop, game.objectId),
    shop: game.shop,
    objectId: game.objectId,
    remoteId: game.remoteId,
    localPlayTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds ?? 0),
    unsyncedDeltaPlayTimeInMilliseconds:
      game.unsyncedDeltaPlayTimeInMilliseconds ?? 0,
    countHydraPlaytime: gamesPlaytime.get(
      levelKeys.game(game.shop, game.objectId)
    )?.countHydraPlaytime,
    lastTimePlayed:
      game.lastTimePlayed instanceof Date
        ? game.lastTimePlayed.toISOString()
        : game.lastTimePlayed,
    ...payload,
  });
};

const getGameExecutables = async () => {
  const gameExecutables = (
    await axios
      .get(import.meta.env.MAIN_VITE_API_URL + "/catalogue/steam/executables")
      .catch(() => {
        return { data: {} };
      })
  ).data as GameExecutables;

  Object.keys(gameExecutables).forEach((key) => {
    gameExecutables[key] = gameExecutables[key]
      .filter((executable) => {
        if (platform === "win32") {
          return executable.os === "win32";
        } else if (platform === "linux") {
          return executable.os === "linux" || executable.os === "win32";
        }

        return false;
      })
      .map((executable) => {
        const lowered = executable.name.toLowerCase();
        const name = lowered.startsWith(">") ? lowered.slice(1) : lowered;

        return {
          name: platform === "win32" ? name.replaceAll("/", "\\") : name,
          os: executable.os,
          exe: name.slice(name.lastIndexOf("/") + 1),
        };
      });
  });

  return gameExecutables;
};

export const gameExecutables = await getGameExecutables();

const findGamePathByProcess = async (
  processMap: Map<string, Set<string>>,
  winePrefixMap: Map<string, string>,
  gameId: string
) => {
  const executables = gameExecutables[gameId];

  for (const executable of executables) {
    const executablewithoutExtension = executable.exe.replace(/\.exe$/i, "");

    const pathSet =
      processMap.get(executable.exe) ??
      processMap.get(executablewithoutExtension);

    if (pathSet) {
      for (const path of pathSet) {
        if (
          path.toLowerCase().endsWith(executable.name) ||
          path.toLowerCase().endsWith(executablewithoutExtension)
        ) {
          const gameKey = levelKeys.game("steam", gameId);
          const game = await gamesSublevel.get(gameKey);

          if (game) {
            const updatedGame: Game = {
              ...updateGameExecutablePath(game, path),
            };

            if (process.platform === "linux" && winePrefixMap.has(path)) {
              updatedGame.winePrefixPath = winePrefixMap.get(path)!;
            }

            await gamesSublevel.put(gameKey, updatedGame);
            logger.info("Set game path", gameKey, path);
          }
        }
      }
    }
  }
};

const getSystemProcessMap = async () => {
  const result = await NativeAddon.getSystemProcessMap();
  if (result === null) return null;

  const {
    processMap: rawMap,
    winePrefixMap: rawWineMap,
    linuxProcesses,
  } = result;

  const processMap = new Map<string, Set<string>>(
    Object.entries(rawMap).map(([k, v]) => [k, new Set(v)])
  );

  const winePrefixMap = new Map<string, string>(Object.entries(rawWineMap));

  return { processMap, winePrefixMap, linuxProcesses };
};

// Do not restore an old import flag or executable after an asynchronous sync.
const persistGamePlaytime = async (
  gameKey: string,
  update: Partial<
    Pick<
      Game,
      | "playTimeInMilliseconds"
      | "lastTimePlayed"
      | "unsyncedDeltaPlayTimeInMilliseconds"
    >
  >
) => {
  await updateGameRecord(gameKey, update);
};

const hasLinuxCompatibilityProcessMatch = (
  game: Game,
  executablePath: string,
  linuxProcesses: LinuxProcessInfo[]
) => {
  if (path.extname(executablePath).toLowerCase() !== ".exe") {
    return false;
  }

  const executableName = path.basename(executablePath).toLowerCase();
  const executableNameWithoutExtension = executableName.replace(/\.exe$/i, "");
  const executableDirectory = path.dirname(executablePath).toLowerCase();
  const expectedWinePrefix = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    game.objectId
  )?.toLowerCase();

  return linuxProcesses.some((process) => {
    if (process.cwd !== executableDirectory) {
      return false;
    }

    if (
      expectedWinePrefix &&
      process.steamCompatDataPath &&
      !doesSteamCompatDataPathMatchWinePrefix(
        process.steamCompatDataPath,
        expectedWinePrefix
      )
    ) {
      return false;
    }

    if (
      process.name === executableName ||
      process.name === executableNameWithoutExtension
    ) {
      return true;
    }

    const processRunsUnderWine = process.exe.includes("wine");

    return processRunsUnderWine && process.name.length > 0;
  });
};

export const watchProcesses = async () => {
  const games = await gamesSublevel
    .values()
    .all()
    .then((results) => {
      return results.filter((game) => game.isDeleted === false);
    });

  if (!games.length) return;

  const systemProcessMap = await getSystemProcessMap();
  if (!isValidProcessWatcherScan(systemProcessMap)) {
    logger.warn("Process enumeration failed; skipping process watcher tick");
    return;
  }
  const { processMap, winePrefixMap, linuxProcesses } = systemProcessMap;

  const pidToProcess = new Map<number, LinuxProcessInfo>(
    linuxProcesses.map((process) => [process.pid, process])
  );

  for (const game of games) {
    const gameKey = levelKeys.game(game.shop, game.objectId);
    const executablePath = game.executablePath;
    if (!executablePath) {
      if (gameExecutables[game.objectId]) {
        await findGamePathByProcess(processMap, winePrefixMap, game.objectId);
      }

      continue;
    }

    const trackingPaths = game.trackingExecutablePaths?.filter(Boolean) ?? [];

    let matchPaths: string[];
    if (isWindowsBatchFile(executablePath)) {
      matchPaths = trackingPaths.length ? trackingPaths : [executablePath];
    } else {
      matchPaths = [executablePath, ...trackingPaths];
    }

    let matchedPath = matchPaths.find((matchPath) => {
      const executable = matchPath
        .slice(matchPath.lastIndexOf(platform === "win32" ? "\\" : "/") + 1)
        .toLowerCase();

      if (processMap.get(executable)?.has(matchPath)) return true;

      if (platform === "linux") {
        return (
          hasLinuxNativeOrAppImageMatch(matchPath, linuxProcesses) ||
          hasLinuxCompatibilityProcessMatch(game, matchPath, linuxProcesses)
        );
      }

      return false;
    });

    if (
      !matchedPath &&
      platform === "linux" &&
      hasLaunchedPidMatch(
        launchedGamePids.get(gameKey),
        executablePath,
        pidToProcess
      )
    ) {
      matchedPath = executablePath;
    }

    if (matchedPath) {
      if (gamesPlaytime.has(gameKey)) {
        onTickGame(game);
      } else {
        await onOpenGame(game, matchedPath);
      }
    } else if (gamesPlaytime.has(gameKey)) {
      onCloseGame(game);
    }
  }

  currentTick++;

  WindowManager.sendToAppWindows("on-games-running", getGamesRunning());
};

async function onOpenGame(game: Game, matchedPath: string) {
  cancelSteamGameExitSync(game);

  const now = performance.now();
  const gameKey = levelKeys.game(game.shop, game.objectId);
  let countHydraPlaytime = true;
  let syncSteamOnExit = false;
  let isSteamLibraryPath = false;

  if (game.shop === "steam") {
    const libraryFolders = await getSteamLibraryFolders().catch(() => []);
    const [resolvedPath, resolvedLibraries] = await Promise.all([
      fs.realpath(matchedPath).catch(() => matchedPath),
      Promise.all(
        libraryFolders.map((folder) => fs.realpath(folder).catch(() => folder))
      ),
    ]);
    isSteamLibraryPath = isSteamLibraryExecutablePath(
      resolvedPath,
      resolvedLibraries
    );

    const hasActiveSteamImport = await resolveActiveSteamImport(
      game.hasActiveSteamImport,
      async (signal) => {
        try {
          return await HydraApi.get<{ hasActiveSteamImport?: boolean }>(
            `/profile/games/steam/${encodeURIComponent(game.objectId)}`,
            undefined,
            { signal }
          );
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 404) {
            return { hasActiveSteamImport: false };
          }
          throw error;
        }
      }
    );

    game = (await updateGameRecord(gameKey, { hasActiveSteamImport })) ?? game;
  }

  if (game.shop === "steam") {
    ({ countHydraPlaytime, syncSteamOnExit } =
      resolveSteamSessionPlaytimePolicy({
        hasActiveSteamImport: game.hasActiveSteamImport === true,
        isSteamLibraryPath,
        enableHydraPlaytimeTracking: game.enableHydraPlaytimeTracking === true,
      }));
  }

  if (game.remoteId) {
    void prepareLinuxGameCaptureSession(gameKey);
  }

  setGamePlaytime(gameKey, {
    lastTick: now,
    firstTick: now,
    lastSyncTick: now,
    countHydraPlaytime,
    syncSteamOnExit,
  });

  logPlaytimeTrace("session-open", game, {
    performanceNow: now,
    matchedPath,
  });

  // On Linux, keep the launcher visible briefly and let it auto-close itself.
  if (process.platform !== "linux") {
    WindowManager.closeGameLauncherWindow();
  }

  // Hide Hydra to tray on game startup if enabled
  db.get<string, UserPreferences | null>(levelKeys.userPreferences, {
    valueEncoding: "json",
  })
    .then((userPreferences) => {
      if (userPreferences?.hideToTrayOnGameStart) {
        WindowManager.mainWindow?.hide();
      }
    })
    .catch(() => {});

  if (game.shop === "custom") return;

  AchievementWatcherManager.syncGameAchievementFiles(game.shop, game.objectId);

  if (game.remoteId) {
    const deltaToSync = game.unsyncedDeltaPlayTimeInMilliseconds ?? 0;
    const syncTimestamp = new Date();

    logPlaytimeTrace("open-sync-track-request", game, {
      deltaToSync,
      syncTimestamp: syncTimestamp.toISOString(),
    });

    trackGamePlaytime(game, deltaToSync, syncTimestamp)
      .then(() => {
        logPlaytimeTrace("open-sync-track-success", game, {
          deltaToSync,
        });

        return persistGamePlaytime(gameKey, {
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
      })
      .catch((error) => {
        logPlaytimeTrace("open-sync-track-failed", game, {
          deltaToSync,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    void runAutomaticCloudSaveOnOpen(game).catch((error: unknown) => {
      handleAutomaticCloudSaveLifecycleError("open", game, error);
    });
  } else {
    const payload = { ...game, lastTimePlayed: new Date() };

    logPlaytimeTrace("open-sync-create-request", payload, {
      syncTimestamp:
        payload.lastTimePlayed instanceof Date
          ? payload.lastTimePlayed.toISOString()
          : payload.lastTimePlayed,
    });

    createGame(payload)
      .then(() => {
        logPlaytimeTrace("open-sync-create-success", payload);
      })
      .catch((error) => {
        logPlaytimeTrace("open-sync-create-failed", payload, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
}

function onTickGame(game: Game) {
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(
    levelKeys.game(game.shop, game.objectId)
  )!;

  const { localDelta: delta, syncDelta: deltaToSync } = getGamePlaytimeDeltas(
    gamePlaytime,
    now,
    game.unsyncedDeltaPlayTimeInMilliseconds ?? 0
  );

  const updatedGame = {
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + delta,
    lastTimePlayed: new Date(),
  };

  void persistGamePlaytime(
    levelKeys.game(game.shop, game.objectId),
    updatedGame
  );

  setGamePlaytime(levelKeys.game(game.shop, game.objectId), {
    ...gamePlaytime,
    lastTick: now,
  });

  if (currentTick % TICKS_TO_UPDATE_API === 0 && game.shop !== "custom") {
    logPlaytimeTrace("periodic-sync-request", game, {
      method: game.remoteId ? "track" : "create",
      deltaToSync,
      performanceNow: now,
      lastSyncTick: gamePlaytime.lastSyncTick,
      lastTick: gamePlaytime.lastTick,
    });

    const gamePromise = game.remoteId
      ? trackGamePlaytime(game, deltaToSync, game.lastTimePlayed!)
      : createGame(game);

    gamePromise
      .then(() => {
        logPlaytimeTrace("periodic-sync-success", game, {
          method: game.remoteId ? "track" : "create",
          deltaToSync,
        });

        return persistGamePlaytime(levelKeys.game(game.shop, game.objectId), {
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
      })
      .catch((error) => {
        logPlaytimeTrace("periodic-sync-failed", game, {
          method: game.remoteId ? "track" : "create",
          deltaToSync,
          error: error instanceof Error ? error.message : String(error),
        });

        return persistGamePlaytime(levelKeys.game(game.shop, game.objectId), {
          unsyncedDeltaPlayTimeInMilliseconds: deltaToSync,
        });
      })
      .finally(() => {
        const current = gamesPlaytime.get(
          levelKeys.game(game.shop, game.objectId)
        );
        if (current?.firstTick !== gamePlaytime.firstTick) return;
        setGamePlaytime(levelKeys.game(game.shop, game.objectId), {
          ...current,
          lastSyncTick: now,
        });
      });
  }
}

const onCloseGame = (game: Game) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(gameKey)!;
  deleteGamePlaytime(gameKey);
  launchedGamePids.delete(gameKey);
  stopLinuxGameCaptureSession(gameKey);
  PowerSaveBlockerManager.markGameClosed(gameKey);
  abortAchievementMetadataExport(gameKey);

  const { localDelta: delta, syncDelta: deltaToSync } = getGamePlaytimeDeltas(
    gamePlaytime,
    now,
    game.unsyncedDeltaPlayTimeInMilliseconds ?? 0
  );

  logPlaytimeTrace("session-close", game, {
    performanceNow: now,
    delta,
    firstTick: gamePlaytime.firstTick,
    lastTick: gamePlaytime.lastTick,
    lastSyncTick: gamePlaytime.lastSyncTick,
    countHydraPlaytime: gamePlaytime.countHydraPlaytime,
  });

  if (
    shouldScheduleSteamGameExitSync(
      game.shop,
      gamePlaytime.syncSteamOnExit === true
    )
  ) {
    scheduleSteamGameExitSync(game);
    logPlaytimeTrace("steam-exit-sync-scheduled", game);
  }

  const updatedGame = {
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + delta,
    lastTimePlayed: new Date(),
  };

  void persistGamePlaytime(gameKey, updatedGame);

  if (game.shop === "custom") return;

  void runAutomaticCloudSaveOnClose(game).catch((error: unknown) => {
    handleAutomaticCloudSaveLifecycleError("close", game, error);
  });

  if (game.remoteId) {
    logPlaytimeTrace("close-sync-track-request", game, {
      deltaToSync,
      syncTimestamp:
        game.lastTimePlayed instanceof Date
          ? game.lastTimePlayed.toISOString()
          : game.lastTimePlayed,
    });

    return trackGamePlaytime(game, deltaToSync, game.lastTimePlayed!)
      .then(() => {
        logPlaytimeTrace("close-sync-track-success", game, {
          deltaToSync,
        });

        return persistGamePlaytime(gameKey, {
          unsyncedDeltaPlayTimeInMilliseconds: 0,
        });
      })
      .catch((error) => {
        logPlaytimeTrace("close-sync-track-failed", game, {
          deltaToSync,
          error: error instanceof Error ? error.message : String(error),
        });

        return persistGamePlaytime(gameKey, {
          unsyncedDeltaPlayTimeInMilliseconds: deltaToSync,
        });
      });
  } else {
    logPlaytimeTrace("close-sync-create-request", game, {
      syncTimestamp:
        game.lastTimePlayed instanceof Date
          ? game.lastTimePlayed.toISOString()
          : game.lastTimePlayed,
    });

    return createGame(game)
      .then(() => {
        logPlaytimeTrace("close-sync-create-success", game);
      })
      .catch((error) => {
        logPlaytimeTrace("close-sync-create-failed", game, {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }
};

export const clearGamesPlaytime = async () => {
  for (const game of gamesPlaytime.keys()) {
    const gameData = await gamesSublevel.get(game);

    if (gameData) {
      await onCloseGame(gameData);
    }
  }

  clearGamesPlaytimeState();
};
