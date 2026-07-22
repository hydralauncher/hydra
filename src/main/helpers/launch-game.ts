import { shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GameShop, type UserPreferences } from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { updateGameExecutablePath } from "./update-executable-path";
import {
  clearCloudSaveLaunchGuard,
  canCreateCloudSaveUploadGuard,
  getCloudSaveGameContext,
  rotateCloudSavePrefixGeneration,
  runAutomaticCloudSaveSync,
  setCloudSaveLaunchGuard,
  shouldBlockGameLaunchForCloudSave,
} from "@main/services/cloud-save";
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
  useGamemode = false,
  winePrefixPath?: string | null
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
          ...(winePrefixPath ? { WINEPREFIX: winePrefixPath } : {}),
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

interface LinuxCompatibilityLaunchContext {
  protonPath: string | null;
  winePrefixPath: string | null;
}

const isValidWinePrefix = (winePrefixPath: string | null) => {
  if (!winePrefixPath) return false;
  try {
    return Wine.validatePrefix(winePrefixPath);
  } catch {
    return false;
  }
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

interface CloudSavePrefixPreparationResult {
  winePrefixPath: string | null;
  readyForRestore: boolean;
  safeForUpload: boolean;
  generationOverride?: Awaited<
    ReturnType<typeof rotateCloudSavePrefixGeneration>
  >;
}

const prepareCompatibilityPrefixForCloudSave = async (
  context: LinuxCompatibilityLaunchContext,
  objectId: string
): Promise<CloudSavePrefixPreparationResult> => {
  const winePrefixPath = context.winePrefixPath;
  if (!winePrefixPath) {
    return {
      winePrefixPath: null,
      readyForRestore: false,
      safeForUpload: false,
    };
  }

  const prefixWasValid = isValidWinePrefix(winePrefixPath);
  const prefixWasReadyForRestore =
    prefixWasValid && Wine.isPrefixReadyForRestore(winePrefixPath);
  let preparationFailed = false;

  if (!prefixWasReadyForRestore) {
    try {
      await Umu.preparePrefix({
        winePrefixPath,
        protonPath: context.protonPath,
        gameId: objectId,
      });
    } catch (error) {
      preparationFailed = true;
      logger.error("Failed to prepare Wine prefix before cloud save restore", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const canonicalWinePrefixPath =
    (await Wine.resolvePrefixPath(winePrefixPath)) ?? winePrefixPath;
  const prefixValid = isValidWinePrefix(canonicalWinePrefixPath);
  const wineProfiles = prefixValid
    ? Wine.getPrefixUserProfiles(canonicalWinePrefixPath)
    : [];
  const readyForRestore = prefixValid && wineProfiles.length > 0;

  logger.info("[Cloud Save] Wine prefix preparation result", {
    objectId,
    requestedWinePrefixPath: winePrefixPath,
    canonicalWinePrefixPath,
    prefixValid,
    wineProfiles,
    readyForRestore,
    preparationFailed,
  });

  if (!readyForRestore) {
    return {
      winePrefixPath: canonicalWinePrefixPath,
      readyForRestore: false,
      safeForUpload: false,
    };
  }

  if (prefixWasReadyForRestore) {
    return {
      winePrefixPath: canonicalWinePrefixPath,
      readyForRestore: true,
      safeForUpload: !preparationFailed,
    };
  }

  const generationOverride = await rotateCloudSavePrefixGeneration(
    canonicalWinePrefixPath
  ).catch((error: unknown) => {
    logger.error("Failed to rotate cloud save prefix generation", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
    return undefined;
  });

  return {
    winePrefixPath: canonicalWinePrefixPath,
    readyForRestore: true,
    safeForUpload: !preparationFailed && generationOverride?.durable === true,
    generationOverride,
  };
};

const cleanupStaleCompatibilityProcesses = async (
  objectId: string,
  winePrefixPath: string | null
) => {
  if (process.platform !== "linux" || !winePrefixPath) return;

  const defaultPrefixPath = await Wine.resolvePrefixPath(
    Wine.getDefaultPrefixPathForGame(objectId)
  );
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

const launchWindowsBinaryOnLinux = async (
  gameKey: string,
  objectId: string,
  parsedPath: string,
  compatibilityContext: LinuxCompatibilityLaunchContext,
  launchOptions: string | null | undefined,
  useMangohud: boolean,
  useGamemode: boolean
): Promise<boolean> => {
  const { protonPath, winePrefixPath } = compatibilityContext;

  try {
    await Umu.launchExecutable(parsedPath, [], {
      winePrefixPath,
      protonPath,
      gameId: objectId,
      launchOptions,
      useGamemode,
      useMangohud,
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
    useGamemode,
    winePrefixPath
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
  clearCloudSaveLaunchGuard(objectId, shop);

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

  let compatibilityContext: LinuxCompatibilityLaunchContext | null = null;
  let prefixReadyForRestore = true;
  let prefixSafeForUpload = true;
  let prefixGenerationOverride:
    | Awaited<ReturnType<typeof rotateCloudSavePrefixGeneration>>
    | undefined;
  if (process.platform === "linux" && isWindowsExecutable(parsedPath)) {
    const requestedWinePrefixPath = Wine.getEffectivePrefixPath(
      game?.winePrefixPath,
      objectId
    );
    compatibilityContext = {
      protonPath: await resolveProtonPathForLaunch(game?.protonPath),
      winePrefixPath: await Wine.resolvePrefixPath(requestedWinePrefixPath),
    };
    logger.info("[Cloud Save] Resolved authoritative launch prefix", {
      shop,
      objectId,
      requestedWinePrefixPath,
      canonicalWinePrefixPath: compatibilityContext.winePrefixPath,
      prefixSource: game?.winePrefixPath ? "game" : "default",
    });
    await cleanupStaleCompatibilityProcesses(
      objectId,
      compatibilityContext.winePrefixPath
    );

    const prefixPreparation = await prepareCompatibilityPrefixForCloudSave(
      compatibilityContext,
      objectId
    );
    prefixReadyForRestore = prefixPreparation.readyForRestore;
    prefixSafeForUpload = prefixPreparation.safeForUpload;
    prefixGenerationOverride = prefixPreparation.generationOverride;
    compatibilityContext = {
      ...compatibilityContext,
      winePrefixPath: prefixPreparation.winePrefixPath,
    };
  }

  const cloudSaveContext = await getCloudSaveGameContext(objectId, shop, {
    executablePath: parsedPath,
    winePrefixPath: compatibilityContext?.winePrefixPath,
    prefixGenerationOverride,
  }).catch((error: unknown) => {
    logger.error("Failed to resolve cloud save launch environment", error);
    return null;
  });
  const preLaunchResult = prefixReadyForRestore
    ? await runAutomaticCloudSaveSync(
        objectId,
        shop,
        "pre-launch",
        cloudSaveContext ?? undefined
      )
    : null;
  if (!prefixReadyForRestore) {
    logger.warn(
      "[Cloud Save] Pre-launch restore skipped because Wine prefix is invalid",
      { shop, objectId }
    );
  }

  if (shouldBlockGameLaunchForCloudSave(preLaunchResult)) {
    const searchParams = new URLSearchParams({
      title: game?.title ?? objectId,
      openCloudSaveConflict: "1",
    });

    logger.warn("[Cloud Save] Game launch blocked by unresolved conflict", {
      shop,
      objectId,
    });
    clearCloudSaveLaunchGuard(objectId, shop);
    WindowManager.closeGameLauncherWindow();
    WindowManager.redirectToMainWindow(
      `game/${shop}/${objectId}?${searchParams.toString()}`
    );
    return null;
  }

  if (cloudSaveContext) {
    setCloudSaveLaunchGuard(objectId, shop, {
      environmentId: cloudSaveContext.environmentId,
      baseRemoteHash: preLaunchResult?.remoteHash ?? null,
      uploadAllowed: canCreateCloudSaveUploadGuard(
        prefixSafeForUpload &&
          cloudSaveContext.prefixIdentityMode !== "session",
        cloudSaveContext.environmentId,
        preLaunchResult
      ),
      createdAt: new Date().toISOString(),
    });
  }

  // Run preflight check for common redistributables (Windows only)
  // Wrapped in try/catch to ensure game launch is never blocked
  if (process.platform === "win32") {
    try {
      logger.log("Starting preflight check for game launch", {
        shop,
        objectId,
      });
      const preflightPassed = await CommonRedistManager.runPreflight();
      logger.log("Preflight check result", { passed: preflightPassed });
    } catch (error) {
      logger.error(
        "Preflight check failed with error, continuing with launch",
        error
      );
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (process.platform === "linux") {
    if (isWindowsExecutable(parsedPath)) {
      if (!compatibilityContext) {
        clearCloudSaveLaunchGuard(objectId, shop);
        return null;
      }
      const launched = await launchWindowsBinaryOnLinux(
        gameKey,
        objectId,
        parsedPath,
        compatibilityContext,
        launchOptions,
        useMangohud,
        useGamemode
      );

      if (launched) return null;
      clearCloudSaveLaunchGuard(objectId, shop);
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
