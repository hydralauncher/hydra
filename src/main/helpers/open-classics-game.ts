import { existsSync } from "node:fs";

import { gamesSublevel, levelKeys } from "@main/level";
import { logger, NativeAddon } from "@main/services";
import type { GameShop, RetroArchPlatform } from "@types";
import { launchClassicsGame } from "./launch-classics-game";
import { launchRetroArchGame } from "./launch-retroarch-game";
import { platformToRetroArchPlatform } from "./platform-to-retroarch-platform";
import { platformToSystem } from "./platform-to-system";

const codedLaunchError = (
  code: string,
  message: string,
  context: Record<string, unknown>
): Error & { code: string } => {
  logger.error("Failed to launch classics game", { code, ...context });
  return Object.assign(new Error(message), { code });
};

const isRpcs3RunningExternally = async (): Promise<number[]> => {
  const procs = await NativeAddon.listProcesses();
  return procs
    .filter((process) => process.name.toLowerCase().includes("rpcs3"))
    .map((process) => process.pid);
};

const RPCS3_EXIT_POLL_INTERVAL_MS = 100;
const RPCS3_EXIT_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const killPids = (pids: number[], signal: NodeJS.Signals = "SIGTERM"): void => {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      void 0;
    }
  }
};

const waitForRpcs3Exit = async (pids: number[]): Promise<boolean> => {
  const start = Date.now();
  while (Date.now() - start < RPCS3_EXIT_TIMEOUT_MS) {
    const alive = await isRpcs3RunningExternally();
    if (!pids.some((pid) => alive.includes(pid))) return true;
    await sleep(RPCS3_EXIT_POLL_INTERVAL_MS);
  }
  return false;
};

const stopRunningRpcs3 = async (
  objectId: string,
  force: boolean | undefined
) => {
  const running = await isRpcs3RunningExternally();
  if (!running.length) return;

  if (!force) {
    throw codedLaunchError(
      "EMULATOR_ALREADY_RUNNING",
      "EMULATOR_ALREADY_RUNNING: rpcs3 is already running",
      { objectId, system: "ps3", pids: running }
    );
  }

  killPids(running);
  let exited = await waitForRpcs3Exit(running);
  if (!exited) {
    killPids(running, "SIGKILL");
    exited = await waitForRpcs3Exit(running);
  }
  if (!exited) {
    throw codedLaunchError(
      "EMULATOR_ALREADY_RUNNING",
      "EMULATOR_ALREADY_RUNNING: rpcs3 did not exit before relaunch",
      { objectId, system: "ps3", pids: running }
    );
  }
};

const translateLaunchError = (
  error: unknown,
  objectId: string,
  system: "ps1" | "ps2" | "ps3"
) => {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;

  if (code === "EMULATOR_NOT_CONFIGURED") {
    return Object.assign(
      codedLaunchError(
        "EMULATOR_NOT_CONFIGURED",
        `EMULATOR_NOT_CONFIGURED: Emulator not configured for ${system}`,
        { objectId, system }
      ),
      { system }
    );
  }

  if (code === "BIOS_NOT_CONFIGURED") {
    return Object.assign(
      codedLaunchError(
        "BIOS_NOT_CONFIGURED",
        `BIOS_NOT_CONFIGURED: BIOS not configured for ${system}`,
        { objectId, system }
      ),
      { system }
    );
  }

  if (code === "PKG_INSTALLING") {
    logger.info("Installing classics PKG before launch", { objectId, system });
    return Object.assign(
      new Error(`PKG_INSTALLING: Installing PKG for ${system}`),
      { code: "PKG_INSTALLING", system }
    );
  }

  if (code === "PKG_UNREADABLE") {
    return Object.assign(
      codedLaunchError(
        "PKG_UNREADABLE",
        `PKG_UNREADABLE: Could not read PKG title id for ${system}`,
        { objectId, system }
      ),
      { system }
    );
  }

  logger.error("Failed to launch classics game", error);
  return error;
};

const launchRetroArchWithErrors = async (
  shop: GameShop,
  objectId: string,
  romPath: string,
  platform: RetroArchPlatform
): Promise<void> => {
  const code = (error: unknown) =>
    error && typeof error === "object" && "code" in error ? error.code : null;

  try {
    await launchRetroArchGame({ shop, objectId, romPath, platform });
  } catch (error) {
    if (code(error) === "RETROARCH_NOT_CONFIGURED") {
      throw Object.assign(
        codedLaunchError(
          "RETROARCH_NOT_CONFIGURED",
          `RETROARCH_NOT_CONFIGURED: RetroArch not configured for ${platform}`,
          { objectId, platform }
        ),
        { system: "retroarch" }
      );
    }

    if (code(error) === "CORE_NOT_INSTALLED") {
      throw Object.assign(
        codedLaunchError(
          "CORE_NOT_INSTALLED",
          `CORE_NOT_INSTALLED: Core not installed for ${platform}`,
          { objectId, platform }
        ),
        { system: "retroarch" }
      );
    }

    logger.error("Failed to launch RetroArch game", error);
    throw error;
  }
};

export const openClassicsGame = async (
  shop: GameShop,
  objectId: string,
  discPath?: string,
  force?: boolean
) => {
  if (shop !== "launchbox") {
    throw new Error("openClassicsGame called for non-launchbox shop");
  }

  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);
  if (!game) throw new Error(`Game not found: ${gameKey}`);

  const retroArchPlatform = platformToRetroArchPlatform(game.platform);
  if (retroArchPlatform) {
    const resolvedRomPath =
      discPath ?? game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
    if (!resolvedRomPath || !existsSync(resolvedRomPath)) {
      throw codedLaunchError(
        "NO_DISC",
        `NO_DISC: No ROM available for game ${objectId}`,
        { objectId, platform: retroArchPlatform, resolvedRomPath }
      );
    }

    await launchRetroArchWithErrors(
      shop,
      objectId,
      resolvedRomPath,
      retroArchPlatform
    );
    return;
  }

  const system = platformToSystem(game.platform);
  if (!system) {
    throw codedLaunchError(
      "PLATFORM_UNKNOWN",
      `PLATFORM_UNKNOWN: Unknown platform for game ${objectId}`,
      { objectId, platform: game.platform }
    );
  }

  const resolvedDiscPath =
    discPath ?? game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;
  if (!resolvedDiscPath || !existsSync(resolvedDiscPath)) {
    throw codedLaunchError(
      "NO_DISC",
      `NO_DISC: No disc available for game ${objectId}`,
      { objectId, system, resolvedDiscPath }
    );
  }

  if (system === "ps3") await stopRunningRpcs3(objectId, force);

  try {
    await launchClassicsGame({
      shop,
      objectId,
      discPath: resolvedDiscPath,
      system,
    });
  } catch (error) {
    throw translateLaunchError(error, objectId, system);
  }
};
