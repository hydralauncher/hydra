import { app } from "electron";
import path from "node:path";
import sudo from "sudo-prompt";

import { isWindowsBatchFile } from "@main/helpers/windows-batch-command";
import { gamesSublevel, levelKeys } from "@main/level";
import { processReferencesExecutable } from "@main/services/linux-process-match";
import { NativeAddon } from "@main/services/native-addon";
import { requestElevatedProcessTermination } from "@main/services/overlay-input-broker";
import { OverlayManager } from "@main/services/overlay-manager";
import {
  expandProcessTree,
  matchesWindowsExecutable,
} from "@main/services/game-process-termination";
import { emulators, launchedGamePids, logger, Wine } from "@main/services";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const isProcessRunning = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const terminateWithSudo = (pid: number) =>
  new Promise<boolean>((resolve) => {
    sudo.exec(
      `kill -9 ${pid}`,
      { name: app.getName() },
      (error, _stdout, _stderr) => {
        if (error) logger.error(error);
        resolve(!error);
      }
    );
  });

const terminateProcesses = async (pids: number[]) => {
  const failed: number[] = [];
  let terminatedDirectly = 0;

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      terminatedDirectly++;
    } catch {
      failed.push(pid);
    }
  }

  if (process.platform === "win32") {
    const terminatedElevated = failed.length
      ? await requestElevatedProcessTermination(failed)
      : false;
    return terminatedDirectly > 0 || terminatedElevated;
  }

  await wait(750);
  for (const pid of pids) {
    if (!isProcessRunning(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      if (!failed.includes(pid)) failed.push(pid);
    }
  }

  const sudoResults = await Promise.all(failed.map(terminateWithSudo));
  return terminatedDirectly > 0 || sudoResults.some(Boolean);
};

const waitForProcessesToExit = async (pids: number[]) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    await wait(250);
    const runningPids = new Set(
      (await NativeAddon.listProcesses()).map(({ pid }) => pid)
    );
    if (pids.every((pid) => !runningPids.has(pid))) return true;
  }
  return false;
};

const closeGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  if (emulators.closeEmulatorSession(levelKeys.game(shop, objectId))) {
    return true;
  }

  const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
  if (!game) return false;

  const processes = await NativeAddon.listProcesses();
  const launchedPid = launchedGamePids.get(levelKeys.game(shop, objectId));
  const trackingPaths = game.trackingExecutablePaths?.filter(Boolean) ?? [];
  const targetPaths =
    game.executablePath && !isWindowsBatchFile(game.executablePath)
      ? [game.executablePath, ...trackingPaths]
      : trackingPaths;

  const gameProcesses = processes.filter((runningProcess) => {
    if (process.platform === "win32") {
      return matchesWindowsExecutable(runningProcess.exe, targetPaths);
    }

    const matchesTargetPath = targetPaths.some((targetPath) =>
      processReferencesExecutable(
        {
          cwd: runningProcess.cwd,
          exe: runningProcess.exe,
          appImagePath: runningProcess.environ?.APPIMAGE,
        },
        targetPath
      )
    );
    if (matchesTargetPath) return true;

    return (
      runningProcess.pid === launchedPid &&
      processReferencesExecutable(
        {
          cwd: runningProcess.cwd,
          exe: runningProcess.exe,
          appImagePath: runningProcess.environ?.APPIMAGE,
        },
        game.executablePath ?? ""
      )
    );
  });

  const linuxFallbackProcess =
    process.platform === "linux" &&
    !gameProcesses.length &&
    game.executablePath?.toLowerCase().endsWith(".exe")
      ? processes.find((runningProcess) => {
          const processCwd = runningProcess.cwd?.toLowerCase();
          const gameDirectory = path
            .dirname(game.executablePath!)
            .toLowerCase();
          if (!processCwd || processCwd !== gameDirectory) return false;

          const expectedPrefix = Wine.getEffectivePrefixPath(
            game.winePrefixPath,
            game.objectId
          )?.toLowerCase();
          const processPrefix =
            runningProcess.environ?.STEAM_COMPAT_DATA_PATH?.toLowerCase();
          if (
            expectedPrefix &&
            processPrefix &&
            processPrefix !== expectedPrefix
          ) {
            return false;
          }

          return runningProcess.exe?.toLowerCase().includes("wine") ?? false;
        })
      : null;

  const rootPids = new Set(gameProcesses.map(({ pid }) => pid));
  if (linuxFallbackProcess) rootPids.add(linuxFallbackProcess.pid);
  if (launchedPid && processes.some(({ pid }) => pid === launchedPid)) {
    rootPids.add(launchedPid);
  }
  const activeGame = OverlayManager.getActiveGame();
  if (activeGame?.shop === shop && activeGame.objectId === objectId) {
    const targetPid = OverlayManager.getTargetProcessId();
    if (targetPid) rootPids.add(targetPid);
  }

  const pids = expandProcessTree(processes, rootPids);
  if (!pids.length) {
    logger.warn("Could not find a running process to close", {
      shop,
      objectId,
    });
    return false;
  }

  if (!(await terminateProcesses(pids))) return false;
  return waitForProcessesToExit(pids);
};

registerEvent("closeGame", closeGame);
