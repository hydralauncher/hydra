import { existsSync } from "node:fs";
import path from "node:path";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { emulators, logger, retroarch } from "@main/services";
import type {
  GameShop,
  RetroArchCoreName,
  RetroArchPlatform,
  UserPreferences,
} from "@types";
import { resolveEmulatorWrappers } from "./launch-classics-game";
import { resolveLaunchCommand } from "./resolve-launch-command";
import { spawnDetachedEmulator } from "./spawn-detached-emulator";
import { prepareEmulatorSouvenirs } from "@main/services/emulators/prepare-emulator-souvenirs";
import { cleanupRetroArchSouvenirSession } from "@main/services/emulators/emulator-souvenir-config";

export class RetroArchNotConfiguredError extends Error {
  code = "RETROARCH_NOT_CONFIGURED" as const;
  platform: RetroArchPlatform;
  constructor(platform: RetroArchPlatform) {
    super(`RetroArch not configured for platform ${platform}`);
    this.platform = platform;
  }
}

export class CoreNotInstalledError extends Error {
  code = "CORE_NOT_INSTALLED" as const;
  platform: RetroArchPlatform;
  core: RetroArchCoreName;
  constructor(platform: RetroArchPlatform, core: RetroArchCoreName) {
    super(`Core ${core} not installed for platform ${platform}`);
    this.platform = platform;
    this.core = core;
  }
}

export interface LaunchRetroArchGameOptions {
  shop: GameShop;
  objectId: string;
  romPath: string;
  platform: RetroArchPlatform;
}

export const launchRetroArchGame = async (
  options: LaunchRetroArchGameOptions
): Promise<void> => {
  const { shop, objectId, romPath, platform } = options;

  const config = await retroarch.getRetroArchConfig();
  if (!config.executablePath || !existsSync(config.executablePath)) {
    throw new RetroArchNotConfiguredError(platform);
  }

  const executablePath = path.normalize(config.executablePath);
  const executableTarget =
    emulators.resolveEmulatorExecutableTarget(executablePath);

  if (!executableTarget || !existsSync(executableTarget)) {
    throw new RetroArchNotConfiguredError(platform);
  }

  const coreName = retroarch.PLATFORM_TO_CORE[platform];
  const core = config.cores[coreName];
  if (!core?.installed || !core.path || !existsSync(core.path)) {
    throw new CoreNotInstalledError(platform, coreName);
  }

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const wrapperCommands = resolveEmulatorWrappers(userPreferences, game);

  const sessionGame = game
    ? {
        ...game,
        selectedDiscPath: romPath,
        lastTimePlayed: new Date(),
      }
    : null;

  if (sessionGame) await gamesSublevel.put(gameKey, sessionGame);

  const souvenirSession = sessionGame
    ? await prepareEmulatorSouvenirs(platform, config.executablePath)
    : null;
  const baseArgs = [
    ...(souvenirSession
      ? ["--appendconfig", souvenirSession.appendConfigPath]
      : []),
    "-L",
    core.path,
    romPath,
    "-f",
  ];

  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: executableTarget,
    baseArgs,
    launchOptions: null,
    wrapperCommands,
  });

  const workingDirectory = path.dirname(executableTarget);

  let sessionStarted = false;

  try {
    const processRef = await spawnDetachedEmulator(
      resolvedLaunchCommand,
      workingDirectory,
      () => new RetroArchNotConfiguredError(platform)
    );

    if (sessionGame) {
      await emulators.startEmulatorSession({
        game: sessionGame,
        system: platform,
        executablePath: config.executablePath,
        sku: null,
        child: processRef,
        souvenirSession,
      });
      sessionStarted = true;
    }

    processRef.unref();
  } catch (error) {
    if (!sessionStarted) {
      await cleanupRetroArchSouvenirSession(souvenirSession);
    }
    logger.error("Failed to spawn RetroArch", error);
    throw error;
  }
};
