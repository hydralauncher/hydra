import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { emulators, logger } from "@main/services";
import type {
  EmulatorBinary,
  EmulatorSystem,
  GameShop,
  UserPreferences,
} from "@types";
import { isGamemodeAvailable } from "./is-gamemode-available";
import { isMangohudAvailable } from "./is-mangohud-available";
import { resolveLaunchCommand } from "./resolve-launch-command";

export class EmulatorNotConfiguredError extends Error {
  code = "EMULATOR_NOT_CONFIGURED" as const;
  system: EmulatorSystem;
  constructor(system: EmulatorSystem) {
    super(`Emulator not configured for system ${system}`);
    this.system = system;
  }
}

export class BiosNotConfiguredError extends Error {
  code = "BIOS_NOT_CONFIGURED" as const;
  system: EmulatorSystem;
  constructor(system: EmulatorSystem) {
    super(`BIOS not configured for system ${system}`);
    this.system = system;
  }
}

export interface LaunchClassicsGameOptions {
  shop: GameShop;
  objectId: string;
  discPath: string;
  system: EmulatorSystem;
}

const buildEmulatorArgs = (
  binary: EmulatorBinary,
  discPath: string
): string[] => {
  switch (binary) {
    case "duckstation":
      return ["-batch", "-fullscreen", "--", discPath];
    case "pcsx2":
      return ["-batch", "-fullscreen", "--", discPath];
    case "rpcs3":
      return ["--no-gui", discPath];
  }
};

export const launchClassicsGame = async (
  options: LaunchClassicsGameOptions
): Promise<void> => {
  const { shop, objectId, discPath, system } = options;

  const config = await emulators.getEmulatorConfig(system);
  if (!config.executablePath || !existsSync(config.executablePath)) {
    throw new EmulatorNotConfiguredError(system);
  }

  // DuckStation/PCSX2 silently crash on launch when no BIOS is present, and the
  // emulator is spawned detached with stdio "ignore" so its own error never
  // reaches us. Detect the missing BIOS up front and block the launch instead.
  if (system === "ps1" || system === "ps2") {
    const biosInstalled = await emulators.isEmulatorBiosInstalled(
      system,
      config.executablePath
    );
    if (!biosInstalled) {
      throw new BiosNotConfiguredError(system);
    }
  }

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

  const selectedDisc = game?.discs?.find((d) => d.path === discPath) ?? null;

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      selectedDiscPath: discPath,
      lastTimePlayed: new Date(),
    });
  }

  const baseArgs = buildEmulatorArgs(config.binary, discPath);
  const executablePath = path.normalize(config.executablePath);
  const executableTarget =
    emulators.resolveEmulatorExecutableTarget(executablePath);

  if (!executableTarget || !existsSync(executableTarget)) {
    throw new EmulatorNotConfiguredError(system);
  }

  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: executableTarget,
    baseArgs,
    launchOptions: null,
    wrapperCommands: [
      ...(useGamemode ? ["gamemoderun"] : []),
      ...(useMangohud ? ["mangohud"] : []),
    ],
  });

  const workingDirectory = path.dirname(executableTarget);

  try {
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

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        processRef.off("error", onError);
        resolve();
      };
      const onError = () => {
        processRef.off("spawn", onSpawn);
        reject(new EmulatorNotConfiguredError(system));
      };
      processRef.once("spawn", onSpawn);
      processRef.once("error", onError);
    });

    if (game) {
      await emulators.startEmulatorSession({
        game,
        system,
        executablePath: config.executablePath,
        sku: selectedDisc?.sku ?? null,
        child: processRef,
      });
    }

    processRef.unref();
  } catch (error) {
    logger.error("Failed to spawn classics emulator", error);
    throw error;
  }
};
