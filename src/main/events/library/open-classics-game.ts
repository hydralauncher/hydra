import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { launchClassicsGame, platformToSystem } from "@main/helpers";
import { logger, NativeAddon } from "@main/services";
import type { GameShop } from "@types";

const isRpcs3RunningExternally = async (): Promise<number[]> => {
  const procs = await NativeAddon.listProcesses();
  return procs
    .filter((p) => p.name.toLowerCase().includes("rpcs3"))
    .map((p) => p.pid);
};

const RPCS3_EXIT_POLL_INTERVAL_MS = 100;
const RPCS3_EXIT_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

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

const openClassicsGame = async (
  _event: Electron.IpcMainInvokeEvent,
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

  if (!game) {
    throw new Error(`Game not found: ${gameKey}`);
  }

  const system = platformToSystem(game.platform);
  if (!system) {
    const error: Error & { code?: string } = new Error(
      `PLATFORM_UNKNOWN: Unknown platform for game ${objectId}`
    );
    error.code = "PLATFORM_UNKNOWN";
    throw error;
  }

  const resolvedDiscPath =
    discPath ?? game.selectedDiscPath ?? game.discs?.[0]?.path ?? null;

  if (!resolvedDiscPath) {
    const error: Error & { code?: string } = new Error(
      `NO_DISC: No disc available for game ${objectId}`
    );
    error.code = "NO_DISC";
    throw error;
  }

  if (system === "ps3") {
    const running = await isRpcs3RunningExternally();
    if (running.length > 0) {
      if (!force) {
        const error: Error & { code?: string } = new Error(
          `EMULATOR_ALREADY_RUNNING: rpcs3 is already running`
        );
        error.code = "EMULATOR_ALREADY_RUNNING";
        throw error;
      }
      killPids(running);
      let exited = await waitForRpcs3Exit(running);
      if (!exited) {
        killPids(running, "SIGKILL");
        exited = await waitForRpcs3Exit(running);
      }
      if (!exited) {
        const error: Error & { code?: string } = new Error(
          `EMULATOR_ALREADY_RUNNING: rpcs3 did not exit before relaunch`
        );
        error.code = "EMULATOR_ALREADY_RUNNING";
        throw error;
      }
    }
  }

  try {
    await launchClassicsGame({
      shop,
      objectId,
      discPath: resolvedDiscPath,
      system,
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EMULATOR_NOT_CONFIGURED"
    ) {
      const wrapped: Error & { code?: string; system?: string } = new Error(
        `EMULATOR_NOT_CONFIGURED: Emulator not configured for ${system}`
      );
      wrapped.code = "EMULATOR_NOT_CONFIGURED";
      wrapped.system = system;
      throw wrapped;
    }
    logger.error("Failed to launch classics game", error);
    throw error;
  }
};

registerEvent("openClassicsGame", openClassicsGame);
