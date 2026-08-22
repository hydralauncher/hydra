import { shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { withGameRecordLock } from "@main/helpers/game-record-lock";
import {
  rankExecutableCandidates,
  type ExecutableSearchScope,
  type KnownGameExecutable,
} from "@main/helpers/game-executable-ranking";
import { registerEvent } from "../register-event";
import { getInstallLocationScanDirectories } from "./scan-installed-games";
import { downloadsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { GameShop } from "@types";
import {
  GameExecutables,
  logger,
  Umu,
  WindowManager,
  Wine,
  runAutomaticCloudSaveSync,
} from "@main/services";

const MAX_INSTALL_SCAN_DEPTH = 6;

const collectAccessibleFilePaths = async (
  rootPath: string
): Promise<string[]> => {
  const filePaths: string[] = [];

  const walk = async (currentPath: string, depth: number) => {
    if (depth > MAX_INSTALL_SCAN_DEPTH) return;

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentPath, {
        withFileTypes: true,
      });
    } catch {
      return;
    }

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await walk(entryPath, depth + 1);
        } else if (entry.isFile()) {
          filePaths.push(path.relative(rootPath, entryPath));
        }
      })
    );
  };

  await walk(rootPath, 0);
  return filePaths;
};

const findGameExecutableResilient = async (
  folderPath: string,
  executables: KnownGameExecutable[],
  scope: ExecutableSearchScope
): Promise<string | null> => {
  if (executables.length === 0) return null;

  const relativeFilePaths = await collectAccessibleFilePaths(folderPath);
  const match = rankExecutableCandidates(relativeFilePaths, executables, scope);

  return match ? path.join(folderPath, match) : null;
};

interface ScanCandidate {
  folderPath: string;
  // "installation" commits to a pick even when ambiguous, appropriate for
  // the download folder since extraction only ever puts one game there.
  // "library" backs off to null on ambiguity instead, required for shared
  // roots (Program Files-equivalents, Steam library folders) that can
  // contain other installed software or games with clashing executable
  // names -- see rankExecutableCandidates in game-executable-ranking.ts.
  scope: ExecutableSearchScope;
}

const getScanCandidates = async (
  downloadFolderPath: string,
  winePrefixPath?: string | null
): Promise<ScanCandidate[]> => {
  const candidates: ScanCandidate[] = [
    { folderPath: downloadFolderPath, scope: "installation" },
  ];

  if (process.platform === "linux" && winePrefixPath) {
    candidates.push({
      folderPath: path.join(winePrefixPath, "drive_c"),
      scope: "library",
    });
  }

  if (process.platform === "win32") {
    const sharedInstallDirectories = await getInstallLocationScanDirectories();
    candidates.push(
      ...sharedInstallDirectories.map((folderPath) => ({
        folderPath,
        scope: "library" as const,
      }))
    );
  }

  return candidates;
};

const rescanAndBindExecutableAfterInstall = async (
  shop: GameShop,
  objectId: string,
  downloadFolderPath: string,
  winePrefixPath?: string | null
) => {
  try {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);

    if (!game || game.executablePath) return;

    const executables = GameExecutables.getExecutablesForGame(objectId);
    if (!executables || executables.length === 0) {
      logger.info(
        `[openGameInstaller] Installer exited for ${objectId}, but no known executables to search for -- skipping rescan`
      );
      return;
    }

    logger.info(
      `[openGameInstaller] Installer exited for ${objectId}, scanning for executable`
    );

    const candidateFolders = await getScanCandidates(
      downloadFolderPath,
      winePrefixPath
    );

    for (const candidate of candidateFolders) {
      if (!fs.existsSync(candidate.folderPath)) continue;

      const foundExePath = await findGameExecutableResilient(
        candidate.folderPath,
        executables,
        candidate.scope
      );

      if (!foundExePath) continue;

      const bound = await withGameRecordLock(gameKey, async () => {
        const latestGame = await gamesSublevel.get(gameKey);
        if (!latestGame || latestGame.executablePath) return false;

        await gamesSublevel.put(gameKey, {
          ...updateGameExecutablePath(latestGame, foundExePath),
        });

        return true;
      });

      if (!bound) return;

      logger.info(
        `[openGameInstaller] Auto-detected executable after installer exit for ${objectId}: ${foundExePath}`
      );

      void runAutomaticCloudSaveSync(objectId, shop, "environment-changed");
      WindowManager.sendToAppWindows("on-library-batch-complete");
      return;
    }

    logger.info(
      `[openGameInstaller] Scanned ${candidateFolders.length} candidate folder(s) for ${objectId}, no matching executable found`
    );
  } catch (error) {
    logger.error(
      `[openGameInstaller] Error scanning for executable after install: ${objectId}`,
      error
    );
  }
};

// shell.openPath (the fallback when we can't spawn the installer ourselves,
// e.g. it needs elevation) hands the launch off to the OS and returns as
// soon as that succeeds -- there's no child process to observe exiting, so
// rescanAndBindExecutableAfterInstall would otherwise never run for these
// launches. Poll instead: check periodically for a bounded window, stopping
// as soon as the executable is found or the game is otherwise linked.
const POST_INSTALL_POLL_INTERVAL_MS = 30_000;
const POST_INSTALL_POLL_ATTEMPTS = 60;

const scheduleRescanPoll = (
  shop: GameShop,
  objectId: string,
  downloadFolderPath: string,
  winePrefixPath?: string | null,
  attemptsRemaining = POST_INSTALL_POLL_ATTEMPTS
) => {
  if (attemptsRemaining <= 0) return;

  setTimeout(() => {
    void (async () => {
      const gameKey = levelKeys.game(shop, objectId);
      const game = await gamesSublevel.get(gameKey).catch(() => null);
      if (!game || game.executablePath) return;

      await rescanAndBindExecutableAfterInstall(
        shop,
        objectId,
        downloadFolderPath,
        winePrefixPath
      );

      const updatedGame = await gamesSublevel.get(gameKey).catch(() => null);
      if (updatedGame?.executablePath) return;

      scheduleRescanPoll(
        shop,
        objectId,
        downloadFolderPath,
        winePrefixPath,
        attemptsRemaining - 1
      );
    })();
  }, POST_INSTALL_POLL_INTERVAL_MS);
};

const launchInstallerWithWine = async (
  filePath: string,
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const child = spawn("wine", [filePath], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });

    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });

    child.once("exit", (code, signal) => {
      onExit?.(code, signal);
    });

    child.once("error", (error) => {
      logger.error("Failed to execute game installer with wine", error);
      resolve(false);
    });
  });
};

const launchInstallerDirectly = async (
  filePath: string,
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void
): Promise<boolean> => {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(filePath, [], {
      detached: true,
      stdio: "ignore",
      shell: false,
    });

    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });

    child.once("exit", (code, signal) => {
      onExit?.(code, signal);
    });

    child.once("error", (error) => {
      logger.error("Failed to execute game installer directly", error);
      resolve(false);
    });
  });
};

const openPathAndCheck = async (filePath: string): Promise<boolean> => {
  const openError = await shell.openPath(filePath);
  return openError.length === 0;
};

const executeGameInstaller = async (
  filePath: string,
  options?: {
    gameId?: string;
    winePrefixPath?: string | null;
    protonPath?: string | null;
    onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
    onIndeterminateLaunch?: () => void;
  }
) => {
  const fallBackToShellOpen = async (targetPath: string) => {
    const opened = await openPathAndCheck(targetPath);
    if (opened) options?.onIndeterminateLaunch?.();
    return opened;
  };

  if (process.platform === "win32") {
    const launchedDirectly = await launchInstallerDirectly(
      filePath,
      options?.onExit
    );
    if (launchedDirectly) {
      return true;
    }

    return await fallBackToShellOpen(filePath);
  }

  if (process.platform === "linux") {
    try {
      await Umu.launchExecutable(filePath, [], {
        gameId: options?.gameId,
        winePrefixPath: options?.winePrefixPath,
        protonPath: options?.protonPath,
        onExit: options?.onExit,
      });
      return true;
    } catch (error) {
      logger.error("Failed to execute game installer with umu-run", error);

      const launchedWithWine = await launchInstallerWithWine(
        filePath,
        options?.onExit
      );
      if (launchedWithWine) {
        return true;
      }

      return await fallBackToShellOpen(filePath);
    }
  }

  return await fallBackToShellOpen(filePath);
};

const openGameInstaller = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const downloadKey = levelKeys.game(shop, objectId);
  const download = await downloadsSublevel.get(downloadKey);
  const game = await gamesSublevel.get(downloadKey).catch(() => null);
  const effectiveWinePrefixPath = Wine.getEffectivePrefixPath(
    game?.winePrefixPath,
    objectId
  );

  if (!download?.folderName) return true;

  const gamePath = path.join(
    download.downloadPath ?? (await getDownloadsPath()),
    download.folderName
  );

  if (!fs.existsSync(gamePath)) {
    return true;
  }

  if (process.platform === "darwin") {
    shell.openPath(gamePath);
    return true;
  }

  if (fs.lstatSync(gamePath).isFile()) {
    shell.showItemInFolder(gamePath);
    return true;
  }

  const onInstallerExit = () => {
    void rescanAndBindExecutableAfterInstall(
      shop,
      objectId,
      gamePath,
      effectiveWinePrefixPath
    );
  };

  const onIndeterminateLaunch = () => {
    scheduleRescanPoll(shop, objectId, gamePath, effectiveWinePrefixPath);
  };

  const setupPath = path.join(gamePath, "setup.exe");
  if (fs.existsSync(setupPath)) {
    return await executeGameInstaller(setupPath, {
      gameId: objectId,
      winePrefixPath: effectiveWinePrefixPath,
      protonPath: game?.protonPath,
      onExit: onInstallerExit,
      onIndeterminateLaunch,
    });
  }

  const gamePathFileNames = fs.readdirSync(gamePath);
  const gamePathExecutableFiles = gamePathFileNames.filter(
    (fileName: string) => path.extname(fileName).toLowerCase() === ".exe"
  );

  if (gamePathExecutableFiles.length === 1) {
    return await executeGameInstaller(
      path.join(gamePath, gamePathExecutableFiles[0]),
      {
        gameId: objectId,
        winePrefixPath: effectiveWinePrefixPath,
        protonPath: game?.protonPath,
        onExit: onInstallerExit,
        onIndeterminateLaunch,
      }
    );
  }

  shell.openPath(gamePath);
  return true;
};

registerEvent("openGameInstaller", openGameInstaller);
