import fs from "node:fs";
import { BrowserWindow } from "electron";

import { gamesSublevel } from "@main/level";
import type { Game } from "@types";

import { emulatorSessions } from "../emulators/emulator-session-tracker";
import { gamesPlaytime } from "../game-running-state";
import { launchedGamePids } from "../launched-game-pids";
import { isWaylandSession } from "../linux-game-capture-session";
import { logger } from "../logger";
import { NativeAddon } from "../native-addon";
import { getForegroundWindow } from "../screenshot";
import { Wine } from "../wine";
import {
  findForegroundGameTarget,
  isLaunchedForegroundProcess,
  parseNamespacedPids,
  type ForegroundProcess,
  type ForegroundWindowInfo,
  type ScreenshotGameTarget,
} from "./foreground-game-match";

export interface ResolvedForegroundGame {
  target: ScreenshotGameTarget;
  game: Game | null;
  foreground: ForegroundWindowInfo | null;
}

const getTrackedGameTarget = (
  gameKey: string,
  game: Game
): ScreenshotGameTarget => ({
  gameKey,
  shop: game.shop,
  objectId: game.objectId,
  title: game.title,
  processId: launchedGamePids.get(gameKey),
  executablePaths: [
    game.executablePath,
    ...(game.trackingExecutablePaths ?? []),
  ].filter((executablePath): executablePath is string =>
    Boolean(executablePath)
  ),
  winePrefixPath:
    process.platform === "linux"
      ? Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId)
      : null,
  isEmulator: false,
});

type ScreenshotGameCandidate = { target: ScreenshotGameTarget; game: Game };

const matchedForegroundProcesses = new Map<number, string>();

export const forgetForegroundGame = (gameKey: string) => {
  for (const [processId, matchedGameKey] of matchedForegroundProcesses) {
    if (matchedGameKey === gameKey)
      matchedForegroundProcesses.delete(processId);
  }
};

const findRememberedCandidate = (
  candidates: ScreenshotGameCandidate[],
  foreground: ForegroundWindowInfo
) => {
  if (foreground.processId === null) return null;
  const gameKey = matchedForegroundProcesses.get(foreground.processId);
  if (!gameKey) return null;
  return (
    candidates.find((candidate) => candidate.target.gameKey === gameKey) ?? null
  );
};

const readGame = (gameKey: string) =>
  gamesSublevel.get(gameKey).catch(() => null);

const getEmulatorCandidates = () =>
  Promise.all(
    [...emulatorSessions].map(
      async ([gameKey, session]): Promise<ScreenshotGameCandidate | null> => {
        const game = await readGame(gameKey);
        if (!game) return null;

        return {
          game,
          target: {
            gameKey,
            shop: session.shop,
            objectId: session.objectId,
            title: game.title,
            processId: session.child.pid,
            executablePaths: [session.executablePath],
            winePrefixPath: null,
            isEmulator: true,
          },
        };
      }
    )
  );

const getTrackedCandidates = () =>
  Promise.all(
    [...gamesPlaytime.keys()]
      .filter((gameKey) => !emulatorSessions.has(gameKey))
      .map(async (gameKey): Promise<ScreenshotGameCandidate | null> => {
        const game = await readGame(gameKey);
        return game
          ? { game, target: getTrackedGameTarget(gameKey, game) }
          : null;
      })
  );

export const getScreenshotGameTargets = async () => {
  const [emulatorCandidates, trackedCandidates] = await Promise.all([
    getEmulatorCandidates(),
    getTrackedCandidates(),
  ]);

  return [...emulatorCandidates, ...trackedCandidates].filter(
    (candidate): candidate is ScreenshotGameCandidate => candidate !== null
  );
};

const readNamespacedPids = (hostPid: number) => {
  try {
    return parseNamespacedPids(
      fs.readFileSync(`/proc/${hostPid}/status`, "utf8")
    );
  } catch {
    return null;
  }
};

const resolveWindowsForegroundWindow =
  async (): Promise<ForegroundWindowInfo | null> => {
    const nativeWindow = NativeAddon.getWindowsForegroundWindow();
    if (nativeWindow) return nativeWindow;
    if (nativeWindow === null) return null;

    const fallback = await getForegroundWindow();
    if (!fallback || !Number.isFinite(fallback.processId)) return null;

    return {
      processId: fallback.processId,
      windowHandle: fallback.windowHandle,
    };
  };

const resolveLinuxForegroundWindow = (): ForegroundWindowInfo | null => {
  const activeWindow = NativeAddon.getLinuxActiveWindow();
  if (!activeWindow) return null;

  return {
    processId: activeWindow.processId,
    windowId: activeWindow.windowId,
    clientProcessId: NativeAddon.getLinuxWindowClientPid(activeWindow.windowId),
  };
};

export const resolveForegroundWindow = async () => {
  if (process.platform === "win32") return resolveWindowsForegroundWindow();
  if (process.platform === "linux") return resolveLinuxForegroundWindow();
  return null;
};

const toForegroundProcesses = (
  processes: Awaited<ReturnType<typeof NativeAddon.listProcesses>>
): ForegroundProcess[] =>
  processes.map((process) => ({
    pid: process.pid,
    parentPid: process.parentPid ?? null,
    exe: process.exe ?? null,
    cwd: process.cwd ?? null,
    environ: process.environ ?? null,
    appImagePath: process.environ?.APPIMAGE ?? null,
  }));

export const resolveForegroundGame = async ({
  allowSingleGameFallback,
}: {
  allowSingleGameFallback: boolean;
}): Promise<ResolvedForegroundGame | null> => {
  const candidates = await getScreenshotGameTargets();
  if (!candidates.length) return null;

  const foreground = await resolveForegroundWindow();

  if (
    foreground &&
    candidates.length === 1 &&
    isLaunchedForegroundProcess(candidates[0].target, foreground)
  ) {
    return { ...candidates[0], foreground };
  }

  if (foreground) {
    const remembered = findRememberedCandidate(candidates, foreground);
    if (remembered) return { ...remembered, foreground };

    const processes = toForegroundProcesses(await NativeAddon.listProcesses());
    const target = findForegroundGameTarget({
      platform: process.platform,
      targets: candidates.map((candidate) => candidate.target),
      foreground,
      processes,
      getNamespacedPids:
        process.platform === "linux" ? readNamespacedPids : undefined,
    });

    if (target) {
      if (foreground.processId !== null) {
        matchedForegroundProcesses.set(foreground.processId, target.gameKey);
      }
      const game =
        candidates.find(
          (candidate) => candidate.target.gameKey === target.gameKey
        )?.game ?? null;
      return { target, game, foreground };
    }

    if (foreground.processId !== null || !isWaylandSession()) {
      logger.info("Screenshot hotkey ignored: no tracked game in foreground", {
        foregroundProcessId: foreground.processId,
      });
      return null;
    }
  }

  const canFallBackToOnlyGame =
    allowSingleGameFallback || BrowserWindow.getFocusedWindow() === null;
  if (canFallBackToOnlyGame && isWaylandSession() && candidates.length === 1) {
    return { ...candidates[0], foreground: null };
  }

  return null;
};
