import { shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

import { getDownloadsPath } from "../helpers/get-downloads-path";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import {
  rankExecutableCandidates,
  type KnownGameExecutable,
} from "@main/helpers/game-executable-ranking";
import { registerEvent } from "../register-event";
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

// After an installer-based repack finishes installing, nothing else in the
// app ever re-checks for the resulting executable -- the only auto-detection
// pass runs once, right after extraction, before the installer has placed
// any files. This scans the plausible install destinations once the
// installer process actually exits, so the game is recognized as installed
// without the user having to set the executable path manually.
//
// Program Files on Windows contains a long tail of folders locked down to
// TrustedInstaller/System that throw EPERM even for elevated processes --
// WindowsApps, various Windows Defender folders, etc. There's no reliable
// list of which ones; fs.readdir's `recursive` option also aborts the
// *entire* walk on the first unreadable subdirectory it hits, so scanning
// Program Files as one big recursive tree means a single restricted folder
// anywhere in the tree can silently block finding an otherwise perfectly
// accessible install elsewhere under it. This walks manually instead,
// catching permission errors per-directory and just skipping that subtree,
// so one inaccessible folder never takes out the rest of the scan.
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
      // Expected for OS-protected folders (WindowsApps, Defender, etc.) --
      // not an error worth surfacing, just an inaccessible subtree to skip.
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
  executables: KnownGameExecutable[]
): Promise<string | null> => {
  if (executables.length === 0) return null;

  const relativeFilePaths = await collectAccessibleFilePaths(folderPath);
  const match = rankExecutableCandidates(relativeFilePaths, executables);

  return match ? path.join(folderPath, match) : null;
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

    const candidateFolders = [downloadFolderPath];

    if (process.platform === "linux" && winePrefixPath) {
      candidateFolders.push(path.join(winePrefixPath, "drive_c"));
    }

    if (process.platform === "win32") {
      candidateFolders.push(
        ...[
          process.env["ProgramFiles"],
          process.env["ProgramFiles(x86)"],
          process.env["LOCALAPPDATA"]
            ? path.join(process.env["LOCALAPPDATA"], "Programs")
            : undefined,
        ].filter((candidate): candidate is string => Boolean(candidate))
      );
    }

    for (const candidateFolder of candidateFolders) {
      if (!fs.existsSync(candidateFolder)) continue;

      const foundExePath = await findGameExecutableResilient(
        candidateFolder,
        executables
      );

      if (!foundExePath) continue;

      // Re-check under the lock of "hasn't been set since we started" --
      // the user may have set it manually while the installer was running.
      const latestGame = await gamesSublevel.get(gameKey);
      if (!latestGame || latestGame.executablePath) return;

      logger.info(
        `[openGameInstaller] Auto-detected executable after installer exit for ${objectId}: ${foundExePath}`
      );

      await gamesSublevel.put(gameKey, {
        ...updateGameExecutablePath(latestGame, foundExePath),
      });

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
  }
) => {
  if (process.platform === "win32") {
    const launchedDirectly = await launchInstallerDirectly(
      filePath,
      options?.onExit
    );
    if (launchedDirectly) {
      return true;
    }

    return await openPathAndCheck(filePath);
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

      return await openPathAndCheck(filePath);
    }
  }

  return await openPathAndCheck(filePath);
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

  const setupPath = path.join(gamePath, "setup.exe");
  if (fs.existsSync(setupPath)) {
    return await executeGameInstaller(setupPath, {
      gameId: objectId,
      winePrefixPath: effectiveWinePrefixPath,
      protonPath: game?.protonPath,
      onExit: onInstallerExit,
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
      }
    );
  }

  shell.openPath(gamePath);
  return true;
};

registerEvent("openGameInstaller", openGameInstaller);
