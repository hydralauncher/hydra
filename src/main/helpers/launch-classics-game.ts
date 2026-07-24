import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { emulators, logger } from "@main/services";
import type {
  EmulatorBinary,
  EmulatorConfig,
  EmulatorSystem,
  Game,
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

export class PkgInstallingError extends Error {
  code = "PKG_INSTALLING" as const;
  system: EmulatorSystem;
  constructor(system: EmulatorSystem) {
    super(`Installing PKG for system ${system}`);
    this.system = system;
  }
}

export class PkgUnreadableError extends Error {
  code = "PKG_UNREADABLE" as const;
  system: EmulatorSystem;
  constructor(system: EmulatorSystem) {
    super(`Could not read PKG title id for system ${system}`);
    this.system = system;
  }
}

const isPkgPath = (filePath: string): boolean =>
  filePath.toLowerCase().endsWith(".pkg");

const isMdsPath = (filePath: string): boolean =>
  filePath.toLowerCase().endsWith(".mds");

const resolvePs2MdsBootTarget = async (mdsPath: string): Promise<string> => {
  const mdf = await emulators.resolveSidecarWithExt(mdsPath, ".mdf");
  if (!mdf) {
    logger.warn("No .mdf sidecar next to .mds, booting the .mds as-is", {
      mdsPath,
    });
    return mdsPath;
  }
  return mdf;
};

const spawnRpcs3PkgInstall = (
  executableTarget: string,
  pkgPath: string
): void => {
  const child = spawn(executableTarget, ["--installpkg", pkgPath], {
    shell: false,
    detached: true,
    stdio: "ignore",
    cwd: path.dirname(executableTarget),
    env: { ...process.env },
  });
  child.on("error", (error) => {
    logger.error("Failed to spawn RPCS3 for PKG install", error);
  });
  child.unref();
};

const resolvePs3PkgBootTarget = async (params: {
  executablePath: string;
  executableTarget: string;
  pkgPath: string;
  system: EmulatorSystem;
}): Promise<string> => {
  const { executablePath, executableTarget, pkgPath, system } = params;

  const titleId = await emulators.extractTitleIdFromPkg(pkgPath);
  if (!titleId) {
    throw new PkgUnreadableError(system);
  }

  const installedEboot = emulators.findInstalledPs3GameEboot(
    executablePath,
    titleId
  );
  if (installedEboot) {
    return installedEboot;
  }

  spawnRpcs3PkgInstall(executableTarget, pkgPath);
  throw new PkgInstallingError(system);
};

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

const assertBiosInstalled = async (
  system: EmulatorSystem,
  config: EmulatorConfig
): Promise<void> => {
  if (system !== "ps1" && system !== "ps2") return;

  const biosDir = await emulators.resolveInstalledBiosDir(
    system,
    config.executablePath,
    config.biosPath
  );
  if (!biosDir) {
    throw new BiosNotConfiguredError(system);
  }
  if (biosDir !== config.biosPath) {
    await emulators.updateEmulatorConfig(system, (current) => ({
      ...current,
      biosPath: biosDir,
    }));
  }
};

const resolveEmulatorWrappers = (
  preferences: UserPreferences | null,
  game: Game | undefined
): string[] => {
  const useMangohud =
    (preferences?.autoRunMangohud === true || game?.autoRunMangohud === true) &&
    isMangohudAvailable();

  const useGamemode =
    (preferences?.autoRunGamemode === true || game?.autoRunGamemode === true) &&
    isGamemodeAvailable();

  return [
    ...(useGamemode ? ["gamemoderun"] : []),
    ...(useMangohud ? ["mangohud"] : []),
  ];
};

export const launchClassicsGame = async (
  options: LaunchClassicsGameOptions
): Promise<void> => {
  const { shop, objectId, discPath, system } = options;

  const config = await emulators.getEmulatorConfig(system);
  if (!config.executablePath || !existsSync(config.executablePath)) {
    throw new EmulatorNotConfiguredError(system);
  }
  const configuredExecutablePath = config.executablePath;

  // DuckStation/PCSX2 silently crash on launch when no BIOS is present, and the
  // emulator is spawned detached with stdio "ignore" so its own error never
  // reaches us. Detect the missing BIOS up front and block the launch instead.
  await assertBiosInstalled(system, config);

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  const userPreferences = await db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);

  const wrapperCommands = resolveEmulatorWrappers(userPreferences, game);

  const selectedDisc = game?.discs?.find((d) => d.path === discPath) ?? null;

  const executablePath = path.normalize(config.executablePath);
  const executableTarget =
    emulators.resolveEmulatorExecutableTarget(executablePath);

  if (!executableTarget || !existsSync(executableTarget)) {
    throw new EmulatorNotConfiguredError(system);
  }

  const resolveBootTarget = async (): Promise<string> => {
    if (system === "ps3" && isPkgPath(discPath)) {
      return resolvePs3PkgBootTarget({
        executablePath: configuredExecutablePath,
        executableTarget,
        pkgPath: discPath,
        system,
      });
    }
    if (config.binary === "pcsx2" && isMdsPath(discPath)) {
      return resolvePs2MdsBootTarget(discPath);
    }
    return discPath;
  };

  const bootTarget = await resolveBootTarget();

  if (game) {
    await gamesSublevel.put(gameKey, {
      ...game,
      selectedDiscPath: discPath,
      lastTimePlayed: new Date(),
    });
  }

  const baseArgs = buildEmulatorArgs(config.binary, bootTarget);

  const resolvedLaunchCommand = resolveLaunchCommand({
    baseCommand: executableTarget,
    baseArgs,
    launchOptions: null,
    wrapperCommands,
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
