import { shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GameShop, type Game, type UserPreferences } from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { updateGameExecutablePath } from "./update-executable-path";
import {
  WindowManager,
  logger,
  Umu,
  PowerSaveBlockerManager,
  Wine,
  NativeAddon,
  launchedGamePids,
} from "@main/services";
import { CommonRedistManager } from "@main/services/common-redist-manager";
import { SystemPath } from "@main/services/system-path";
import { detectWindowsCompatibility } from "@main/services/windows-compatibility-detector";
import { parseExecutablePath } from "../events/helpers/parse-executable-path";
import { isGamemodeAvailable } from "./is-gamemode-available";
import { isMangohudAvailable } from "./is-mangohud-available";
import { resolveLaunchCommand } from "./resolve-launch-command";
import {
  buildWindowsBatchCommand,
  isWindowsBatchFile,
} from "./windows-batch-command";

export interface LaunchGameOptions {
  shop: GameShop;
  objectId: string;
  executablePath: string;
  launchOptions?: string | null;
}

const isWindowsExecutable = (executablePath: string) =>
  path.extname(executablePath).toLowerCase() === ".exe";

const ensureExecutablePermission = (executablePath: string) => {
  try {
    const currentMode = fs.statSync(executablePath).mode;
    const hasOwnerExecuteBit = (currentMode & 0o100) !== 0;

    if (!hasOwnerExecuteBit) {
      fs.chmodSync(executablePath, currentMode | 0o100);
    }
  } catch (error) {
    logger.warn("Failed to ensure executable permission", {
      executablePath,
      error,
    });
  }
};

const launchNatively = (
  executablePath: string,
  launchOptions?: string | null,
  useMangohud = false,
  useGamemode = false
): number | null => {
  const workingDirectory = path.dirname(executablePath);
  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: executablePath,
    launchOptions,
    wrapperCommands: [
      ...(useGamemode ? ["gamemoderun"] : []),
      ...(useMangohud ? ["mangohud"] : []),
    ],
  });

  if (process.platform === "linux") {
    ensureExecutablePermission(executablePath);
  } else if (
    resolvedLaunchCommand.command === executablePath &&
    resolvedLaunchCommand.args.length === 0 &&
    Object.keys(resolvedLaunchCommand.env).length === 0
  ) {
    shell.openPath(executablePath);
    return null;
  }

  if (
    process.platform === "win32" &&
    isWindowsBatchFile(resolvedLaunchCommand.command)
  ) {
    const processRef = spawn(
      buildWindowsBatchCommand(
        resolvedLaunchCommand.command,
        resolvedLaunchCommand.args
      ),
      {
        shell: true,
        detached: true,
        stdio: "ignore",
        cwd: workingDirectory,
        env: {
          ...process.env,
          ...resolvedLaunchCommand.env,
        },
      }
    );

    processRef.on("error", (error) => {
      logger.error("Failed to launch game", error);
    });

    processRef.unref();

    return processRef.pid ?? null;
  }

  const processRef = spawn(
    resolvedLaunchCommand.command,
    resolvedLaunchCommand.args,
    {
      shell: false,
      detached: true,
      stdio: "ignore",
      cwd: workingDirectory,
      env: {
        ...process.env,
        ...resolvedLaunchCommand.env,
      },
    }
  );

  processRef.on("error", (error) => {
    logger.error("Failed to launch game", error);
  });

  processRef.unref();

  return processRef.pid ?? null;
};

const launchWithWine = async (
  executablePath: string,
  launchOptions?: string | null,
  useMangohud = false,
  useGamemode = false
): Promise<boolean> => {
  const workingDirectory = path.dirname(executablePath);
  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: "wine",
    baseArgs: [executablePath],
    launchOptions,
    wrapperCommands: [
      ...(useGamemode ? ["gamemoderun"] : []),
      ...(useMangohud ? ["mangohud"] : []),
    ],
  });

  return await new Promise<boolean>((resolve) => {
    const processRef = spawn(
      resolvedLaunchCommand.command,
      resolvedLaunchCommand.args,
      {
        shell: false,
        detached: true,
        stdio: "ignore",
        cwd: workingDirectory,
        env: {
          ...process.env,
          ...resolvedLaunchCommand.env,
        },
      }
    );

    processRef.once("spawn", () => {
      processRef.unref();
      resolve(true);
    });

    processRef.once("error", (error) => {
      logger.error("Failed to launch game with Wine", error);
      resolve(false);
    });
  });
};

const resolveProtonPathForLaunch = async (
  gameProtonPath?: string | null
): Promise<string | null> => {
  if (gameProtonPath && Umu.isValidProtonPath(gameProtonPath)) {
    return gameProtonPath;
  }

  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const defaultProtonPath = userPreferences?.defaultProtonPath;

  if (defaultProtonPath && Umu.isValidProtonPath(defaultProtonPath)) {
    return defaultProtonPath;
  }

  return null;
};

const cleanupStaleCompatibilityProcesses = async (
  objectId: string,
  winePrefixPath: string | null
) => {
  if (process.platform !== "linux" || !winePrefixPath) return;

  const defaultPrefixPath = Wine.getDefaultPrefixPathForGame(objectId);
  if (defaultPrefixPath !== winePrefixPath) return;

  const processes = await NativeAddon.listProcesses();

  const stalePids = processes
    .filter((runningProcess) => {
      const processPrefix = runningProcess.environ?.STEAM_COMPAT_DATA_PATH;
      if (processPrefix !== winePrefixPath) return false;

      const processExe = runningProcess.exe?.toLowerCase() ?? "";
      const processName = runningProcess.name.toLowerCase();

      return (
        processExe.includes("wine") ||
        processName.endsWith(".exe") ||
        processName === "wineserver"
      );
    })
    .map((runningProcess) => runningProcess.pid);

  if (!stalePids.length) return;

  logger.info("Killing stale compatibility processes before game launch", {
    objectId,
    winePrefixPath,
    stalePids,
  });

  for (const pid of stalePids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore races and missing permissions.
    }
  }
};

const ensureSteamOverlayDependency = (
  winePrefixPath: string | null,
  detectedFiles: string[]
) => {
  if (!winePrefixPath) return;

  const needsSteamOverlay = detectedFiles.some(
    (file) => path.basename(file).toLowerCase() === "steamoverlay64.dll"
  );

  if (!needsSteamOverlay) return;

  const targetDirectory = path.join(
    winePrefixPath,
    "drive_c",
    "Program Files (x86)",
    "Steam"
  );

  const targetPath = path.join(targetDirectory, "GameOverlayRenderer64.dll");

  if (fs.existsSync(targetPath)) return;

  const homePath = SystemPath.getPath("home");

  const sourceCandidates = [
    path.join(
      homePath,
      ".local",
      "share",
      "Steam",
      "GameOverlayRenderer64.dll"
    ),
    path.join(homePath, ".steam", "steam", "GameOverlayRenderer64.dll"),
  ];

  const sourcePath = sourceCandidates.find((candidate) =>
    fs.existsSync(candidate)
  );

  if (!sourcePath) {
    logger.warn("Steam overlay dependency was detected but not found", {
      targetPath,
      sourceCandidates,
    });
    return;
  }

  try {
    fs.mkdirSync(targetDirectory, { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);

    logger.info("Provisioned Steam overlay dependency", {
      source: sourcePath,
      destination: targetPath,
    });
  } catch (error) {
    logger.error("Failed to provision Steam overlay dependency", error);
  }
};

/**
 * Calculate Steam's 64-bit game id for a non-Steam shortcut.
 *
 * shortcuts.vdf stores a uint32 appid. Steam represents a non-Steam game
 * internally as:
 *
 *   (shortcutAppId << 32) | 0x02000000
 */
const getSteamShortcutGameId = (executablePath: string): bigint | null => {
  const homePath = SystemPath.getPath("home");

  const userdataRoots = [
    path.join(homePath, ".local", "share", "Steam", "userdata"),
    path.join(homePath, ".steam", "steam", "userdata"),
  ];

  const normalizedTarget = path.resolve(executablePath);

  for (const userdataRoot of userdataRoots) {
    if (!fs.existsSync(userdataRoot)) continue;

    let users: fs.Dirent[];

    try {
      users = fs.readdirSync(userdataRoot, { withFileTypes: true });
    } catch (error) {
      logger.warn("Could not inspect Steam userdata", {
        userdataRoot,
        error,
      });
      continue;
    }

    for (const user of users) {
      if (!user.isDirectory()) continue;

      const shortcutsPath = path.join(
        userdataRoot,
        user.name,
        "config",
        "shortcuts.vdf"
      );

      if (!fs.existsSync(shortcutsPath)) continue;

      let data: Buffer;

      try {
        data = fs.readFileSync(shortcutsPath);
      } catch (error) {
        logger.warn("Could not read Steam shortcuts", {
          shortcutsPath,
          error,
        });
        continue;
      }

      /*
       * Binary VDF shortcut records contain:
       *
       *   0x02 "appid\0" <uint32 little endian>
       *
       * followed by the fields belonging to that shortcut. Split records on
       * the next appid field and inspect each record independently. This is
       * important because different shortcuts may use the same executable
       * filename.
       */
      const marker = Buffer.from([0x02, 0x61, 0x70, 0x70, 0x69, 0x64, 0x00]);

      let offset = 0;

      while (offset < data.length) {
        const start = data.indexOf(marker, offset);
        if (start === -1) break;

        const appIdOffset = start + marker.length;

        if (appIdOffset + 4 > data.length) break;

        const next = data.indexOf(marker, appIdOffset + 4);
        const end = next === -1 ? data.length : next;
        const record = data.subarray(start, end);

        const shortcutAppId = data.readUInt32LE(appIdOffset);

        /*
         * VDF strings are NUL terminated. Extract printable strings and look
         * for the exact executable path rather than merely the basename.
         */
        const strings = record
          .toString("latin1")
          .split("\0")
          .map((value) => value.trim())
          .filter(Boolean);

        const matchingExecutable = strings.find((value) => {
          let candidate = value;

          if (
            candidate.length >= 2 &&
            candidate.startsWith('"') &&
            candidate.endsWith('"')
          ) {
            candidate = candidate.slice(1, -1);
          }

          if (!candidate.startsWith("/")) return false;

          try {
            return path.resolve(candidate) === normalizedTarget;
          } catch {
            return false;
          }
        });

        if (matchingExecutable) {
          const gameId = (BigInt(shortcutAppId) << 32n) | 0x02000000n;

          logger.info("Matched Steam non-Steam shortcut", {
            executable: normalizedTarget,
            shortcutsPath,
            shortcutAppId,
            gameId: gameId.toString(),
          });

          return gameId;
        }

        offset = appIdOffset + 4;
      }
    }
  }

  return null;
};

/**
 * Ask the running Steam client to perform the launch itself.
 *
 * This deliberately does not attempt to reproduce Steam's pressure-vessel,
 * overlay or IPC environment. Steam owns creation of that environment.
 */
const launchThroughSteamShortcut = (executablePath: string): boolean => {
  const gameId = getSteamShortcutGameId(executablePath);

  if (gameId === null) {
    logger.info("No matching Steam shortcut found", {
      executable: executablePath,
    });

    return false;
  }

  const uri = `steam://rungameid/${gameId.toString()}`;

  try {
    const steamProcess = spawn("steam", [uri], {
      shell: false,
      detached: true,
      stdio: "ignore",
    });

    steamProcess.on("error", (error) => {
      logger.error("Steam shortcut launch failed", {
        executable: executablePath,
        uri,
        error,
      });
    });

    steamProcess.unref();

    logger.info("Delegated compatibility launch to Steam", {
      executable: executablePath,
      gameId: gameId.toString(),
      uri,
    });

    return true;
  } catch (error) {
    logger.error("Could not delegate compatibility launch to Steam", {
      executable: executablePath,
      uri,
      error,
    });

    return false;
  }
};

const launchWindowsBinaryOnLinux = async (
  gameKey: string,
  objectId: string,
  parsedPath: string,
  game: Game | undefined,
  launchOptions: string | null | undefined,
  useMangohud: boolean,
  useGamemode: boolean
): Promise<boolean> => {
  const protonPath = await resolveProtonPathForLaunch(game?.protonPath);
  const winePrefixPath = Wine.getEffectivePrefixPath(
    game?.winePrefixPath,
    objectId
  );

  await cleanupStaleCompatibilityProcesses(objectId, winePrefixPath);

  const compatibilityResult = await detectWindowsCompatibility(
    path.dirname(parsedPath)
  );

  const detectedWineDllOverrides =
    compatibilityResult.requiresCompatibilityMode &&
    compatibilityResult.overrides
      ? compatibilityResult.overrides
      : null;

  if (compatibilityResult.requiresCompatibilityMode) {
    ensureSteamOverlayDependency(
      winePrefixPath,
      compatibilityResult.detectedFiles
    );

    logger.info("Detected Windows compatibility files", {
      executable: parsedPath,
      provider: compatibilityResult.provider,
      overrides: detectedWineDllOverrides,
      detectedFiles: compatibilityResult.detectedFiles,
      managedEntries: compatibilityResult.managedEntries,
      warnings: compatibilityResult.warnings,
    });
  }

  /*
   * Some Windows compatibility setups require a launch that is genuinely
   * owned by the Steam client. If the exact executable already exists as a
   * non-Steam shortcut, delegate to Steam before attempting UMU.
   *
   * Exact-path matching prevents selecting another shortcut with the same
   * executable filename.
   */
  if (
    compatibilityResult.requiresCompatibilityMode &&
    launchThroughSteamShortcut(parsedPath)
  ) {
    PowerSaveBlockerManager.markCompatibilityLaunchStarted(gameKey);
    return true;
  }

  try {
    await Umu.launchExecutable(parsedPath, [], {
      winePrefixPath,
      protonPath,
      gameId: objectId,
      launchOptions,
      useGamemode,
      useMangohud,
      wineDllOverrides: detectedWineDllOverrides,
      compatibilityMode: compatibilityResult.requiresCompatibilityMode,
    });
    PowerSaveBlockerManager.markCompatibilityLaunchStarted(gameKey);
    return true;
  } catch (error) {
    logger.error("Failed to launch game with umu-run, falling back", error);
  }

  const launchedWithWine = await launchWithWine(
    parsedPath,
    launchOptions,
    useMangohud,
    useGamemode
  );

  if (launchedWithWine) {
    PowerSaveBlockerManager.markCompatibilityLaunchStarted(gameKey);
    return true;
  }

  return false;
};

/**
 * Shows the launcher window and launches the game executable
 * Shared between deep link handler and openGame event
 */
export const launchGame = async (
  options: LaunchGameOptions
): Promise<number | null> => {
  const { shop, objectId, executablePath, launchOptions } = options;

  const parsedPath = parseExecutablePath(executablePath);

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const useMangohud =
    (userPreferences?.autoRunMangohud === true ||
      game?.autoRunMangohud === true) &&
    isMangohudAvailable();

  const useGamemode =
    (userPreferences?.autoRunGamemode === true ||
      game?.autoRunGamemode === true) &&
    isGamemodeAvailable();

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...updateGameExecutablePath(game, parsedPath),
      launchOptions,
    });
  }

  await WindowManager.createGameLauncherWindow(shop, objectId);

  if (process.platform === "win32") {
    try {
      logger.log("Starting preflight check for game launch", {
        shop,
        objectId,
      });
      const preflightPassed = await CommonRedistManager.runPreflight();
      logger.log("Preflight check result", { passed: preflightPassed });
    } catch (error) {
      logger.error("Preflight check failed with error", error);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (process.platform === "linux") {
    if (isWindowsExecutable(parsedPath)) {
      const launched = await launchWindowsBinaryOnLinux(
        gameKey,
        objectId,
        parsedPath,
        game,
        launchOptions,
        useMangohud,
        useGamemode
      );

      if (launched) return null;
    }

    const pid = launchNatively(
      parsedPath,
      launchOptions,
      useMangohud,
      useGamemode
    );

    if (pid !== null) launchedGamePids.set(gameKey, pid);

    return pid;
  }

  return launchNatively(parsedPath, launchOptions, useMangohud, useGamemode);
};
