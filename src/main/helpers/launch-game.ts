import { shell } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { GameShop, type UserPreferences } from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import {
  WindowManager,
  logger,
  Umu,
  PowerSaveBlockerManager,
  Wine,
} from "@main/services";
import { CommonRedistManager } from "@main/services/common-redist-manager";
import { parseExecutablePath } from "../events/helpers/parse-executable-path";
import { isMangohudAvailable } from "./is-mangohud-available";
import { resolveLaunchCommand } from "./resolve-launch-command";

export interface LaunchGameOptions {
  shop: GameShop;
  objectId: string;
  executablePath: string;
  launchOptions?: string | null;
}

const isWindowsExecutable = (executablePath: string) =>
  path.extname(executablePath).toLowerCase() === ".exe";

const launchNatively = (
  executablePath: string,
  launchOptions?: string | null,
  useMangohud = false
) => {
  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: executablePath,
    launchOptions,
    wrapperCommand: useMangohud ? "mangohud" : null,
  });

  if (
    resolvedLaunchCommand.command === executablePath &&
    resolvedLaunchCommand.args.length === 0 &&
    Object.keys(resolvedLaunchCommand.env).length === 0
  ) {
    shell.openPath(executablePath);
    return;
  }

  const processRef = spawn(
    resolvedLaunchCommand.command,
    resolvedLaunchCommand.args,
    {
      shell: false,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        ...resolvedLaunchCommand.env,
      },
    }
  );

  processRef.unref();
};

const launchWithWine = async (
  executablePath: string,
  launchOptions?: string | null,
  winePrefixPath?: string | null,
  useMangohud = false
): Promise<boolean> => {
  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: "wine",
    baseArgs: [executablePath],
    launchOptions,
    wrapperCommand: useMangohud ? "mangohud" : null,
  });

  return await new Promise<boolean>((resolve) => {
    const processRef = spawn(
      resolvedLaunchCommand.command,
      resolvedLaunchCommand.args,
      {
        shell: false,
        detached: true,
        stdio: "ignore",
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

/**
 * Shows the launcher window and launches the game executable
 * Shared between deep link handler and openGame event
 */
export const launchGame = async (options: LaunchGameOptions): Promise<void> => {
  const { shop, objectId, executablePath, launchOptions } = options;

  const parsedPath = parseExecutablePath(executablePath);

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);
  const useMangohud = Boolean(game?.autoRunMangohud) && isMangohudAvailable();

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      executablePath: parsedPath,
      launchOptions,
    });
  }

  await WindowManager.createGameLauncherWindow(shop, objectId);

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
    const isWindowsBinary = isWindowsExecutable(parsedPath);

    if (isWindowsBinary) {
      const winePrefixPath = Wine.getEffectivePrefixPath(game?.winePrefixPath);
      const protonPath = await resolveProtonPathForLaunch(game?.protonPath);

      try {
        await Umu.launchExecutable(parsedPath, [], {
          winePrefixPath,
          protonPath,
          gameId: options.shop === "steam" ? options.objectId : null,
          launchOptions,
          useMangohud,
        });
        PowerSaveBlockerManager.markCompatibilityLaunchStarted(gameKey);
        return;
      } catch (error) {
        logger.error("Failed to launch game with umu-run, falling back", error);
      }

      const launchedWithWine = await launchWithWine(
        parsedPath,
        launchOptions,
        winePrefixPath,
        useMangohud
      );

      if (launchedWithWine) {
        PowerSaveBlockerManager.markCompatibilityLaunchStarted(gameKey);
        return;
      }
    }

    launchNatively(parsedPath, launchOptions, useMangohud);
    return;
  }

  launchNatively(parsedPath, launchOptions, useMangohud);
};
