import fs from "node:fs";
import { BrowserWindow } from "electron";

import { gamesSublevel } from "@main/level";
import type { Game, ScreenshotTriggerSource } from "@types";

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
  findSoleLaunchedTarget,
  isLaunchedForegroundProcess,
  parseNamespacedPids,
  type ForegroundProcess,
  type ForegroundWindowInfo,
  type ScreenshotGameTarget,
} from "./foreground-game-match";
import { getWaylandFocus } from "./wayland-focus";

type ForegroundMatch = ResolvedForegroundGame | null;

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

const matchedForegroundProcesses = new Map<
  number,
  { gameKey: string; windowKey: string | null }
>();

const getForegroundWindowKey = (foreground: ForegroundWindowInfo) =>
  foreground.windowHandle ?? foreground.windowId ?? null;

export const forgetForegroundGame = (gameKey: string) => {
  for (const [processId, match] of matchedForegroundProcesses) {
    if (match.gameKey === gameKey) matchedForegroundProcesses.delete(processId);
  }
};

const findRememberedCandidate = (
  candidates: ScreenshotGameCandidate[],
  foreground: ForegroundWindowInfo
) => {
  if (foreground.processId === null) return null;
  const match = matchedForegroundProcesses.get(foreground.processId);
  if (!match) return null;
  if (match.windowKey !== getForegroundWindowKey(foreground)) {
    matchedForegroundProcesses.delete(foreground.processId);
    return null;
  }
  return (
    candidates.find(
      (candidate) => candidate.target.gameKey === match.gameKey
    ) ?? null
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

const readNamespacedPids = (hostPid: number) =>
  fs.promises
    .readFile(`/proc/${hostPid}/status`, "utf8")
    .then(parseNamespacedPids, () => null);

const needsNamespacedPids = (
  foreground: ForegroundWindowInfo,
  candidates: ScreenshotGameCandidate[]
) =>
  process.platform === "linux" &&
  foreground.clientProcessId == null &&
  foreground.processId !== null &&
  candidates.some((candidate) => candidate.target.processId !== undefined);

const loadNamespacedPidLookup = async (processes: ForegroundProcess[]) => {
  const entries = await Promise.all(
    processes.map(
      async (entry) => [entry.pid, await readNamespacedPids(entry.pid)] as const
    )
  );
  const namespacedPids = new Map(entries);
  return (hostPid: number) => namespacedPids.get(hostPid) ?? null;
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

const resolveLinuxForegroundWindow =
  async (): Promise<ForegroundWindowInfo | null> => {
    if (isWaylandSession()) {
      const focus = await getWaylandFocus();
      if (focus) {
        return { processId: focus.processId, focusSource: focus.source };
      }
    }

    const activeWindow = NativeAddon.getLinuxActiveWindow();
    if (!activeWindow) return null;

    return {
      processId: activeWindow.processId,
      windowId: activeWindow.windowId,
      clientProcessId: NativeAddon.getLinuxWindowClientPid(
        activeWindow.windowId
      ),
      focusSource: "x11",
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

const describeForeground = (foreground: ForegroundWindowInfo | null) =>
  foreground && {
    processId: foreground.processId,
    clientProcessId: foreground.clientProcessId ?? null,
    windowId: foreground.windowId ?? null,
    windowHandle: foreground.windowHandle ?? null,
    focusSource: foreground.focusSource ?? null,
  };

const describeCandidates = (candidates: ScreenshotGameCandidate[]) =>
  candidates.map((candidate) => ({
    gameKey: candidate.target.gameKey,
    processId: candidate.target.processId ?? null,
  }));

const logForegroundMatch = (
  source: ScreenshotTriggerSource,
  matchedBy: string,
  gameKey: string,
  foreground: ForegroundWindowInfo | null
) => {
  logger.debug("Screenshot foreground game resolved", {
    source,
    matchedBy,
    gameKey,
    foreground: describeForeground(foreground),
  });
};

const findProcessTreeTarget = async (
  candidates: ScreenshotGameCandidate[],
  foreground: ForegroundWindowInfo
) => {
  const processes = toForegroundProcesses(await NativeAddon.listProcesses());
  const matchInput = {
    platform: process.platform,
    targets: candidates.map((candidate) => candidate.target),
    foreground,
    processes,
  };
  const target = findForegroundGameTarget(matchInput);
  if (target || !needsNamespacedPids(foreground, candidates)) return target;

  return findForegroundGameTarget({
    ...matchInput,
    getNamespacedPids: await loadNamespacedPidLookup(processes),
  });
};

const rememberForegroundProcess = (
  foreground: ForegroundWindowInfo,
  target: ScreenshotGameTarget
) => {
  if (foreground.processId === null) return;
  matchedForegroundProcesses.set(foreground.processId, {
    gameKey: target.gameKey,
    windowKey: getForegroundWindowKey(foreground),
  });
};

export const resolveForegroundGame = async (
  source: ScreenshotTriggerSource
): Promise<ForegroundMatch> => {
  const candidates = await getScreenshotGameTargets();
  if (!candidates.length) {
    logger.debug("Screenshot hotkey ignored: no running game", { source });
    return null;
  }

  const foreground = await resolveForegroundWindow();

  if (
    foreground &&
    candidates.length === 1 &&
    isLaunchedForegroundProcess(candidates[0].target, foreground)
  ) {
    logForegroundMatch(
      source,
      "launched_process",
      candidates[0].target.gameKey,
      foreground
    );
    return { ...candidates[0], foreground };
  }

  if (foreground) {
    const remembered = findRememberedCandidate(candidates, foreground);
    if (remembered) {
      logForegroundMatch(
        source,
        "remembered_process",
        remembered.target.gameKey,
        foreground
      );
      return { ...remembered, foreground };
    }

    const target = await findProcessTreeTarget(candidates, foreground);
    if (target) {
      rememberForegroundProcess(foreground, target);
      const game =
        candidates.find(
          (candidate) => candidate.target.gameKey === target.gameKey
        )?.game ?? null;
      logForegroundMatch(source, "process_tree", target.gameKey, foreground);
      return { target, game, foreground };
    }

    if (foreground.processId !== null || !isWaylandSession()) {
      logger.debug("Screenshot hotkey ignored: no tracked game in foreground", {
        source,
        foregroundProcessId: foreground.processId,
        clientProcessId: foreground.clientProcessId ?? null,
        windowId: foreground.windowId ?? null,
        candidates: describeCandidates(candidates),
      });
      return null;
    }
  }

  const isWayland = isWaylandSession();
  const isHydraFocused = BrowserWindow.getFocusedWindow() !== null;
  const isDeepLink = source === "deeplink";
  if (!isWayland || isHydraFocused || isDeepLink) {
    logger.debug("Screenshot hotkey ignored: foreground window unresolved", {
      source,
      foreground: describeForeground(foreground),
      isWayland,
      isHydraFocused,
      isDeepLink,
      candidates: describeCandidates(candidates),
    });
    return null;
  }

  const soleTarget = findSoleLaunchedTarget(
    candidates.map((candidate) => candidate.target)
  );
  const soleCandidate = candidates.find(
    (candidate) => candidate.target === soleTarget
  );
  if (!soleCandidate) {
    logger.debug("Screenshot hotkey ignored: no single launched game", {
      source,
      candidates: describeCandidates(candidates),
    });
    return null;
  }
  logForegroundMatch(
    source,
    "sole_launched_game",
    soleCandidate.target.gameKey,
    null
  );
  return { ...soleCandidate, foreground: null };
};
