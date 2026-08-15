import type { GameShop } from "@types";
import { logger } from "@main/services";
import type { MacCompatibilityManager } from "@main/services/mac-compatibility/MacCompatibilityManager";
import {
  getMacCompatibilityManager,
  isMacCompatibilitySupported,
} from "@main/services/mac-compatibility/mac-compatibility-instance";
import type {
  MacCompatibilityGameKey,
  MacCompatibilityStatus,
  MacWineEnvironment,
} from "@main/services/mac-compatibility/MacCompatibilityTypes";
import { registerEvent } from "../register-event";

export interface MacCompatibilityActionResult {
  success: boolean;
  status: MacCompatibilityStatus;
  message: string;
  environment: MacWineEnvironment | null;
}

type MacCompatibilityManagerLike = Pick<
  MacCompatibilityManager,
  | "getGameEnvironment"
  | "createGameEnvironment"
  | "testGameEnvironment"
  | "repairGameEnvironment"
  | "deleteGameEnvironment"
>;

const unsupportedResult: MacCompatibilityActionResult = {
  success: false,
  status: "unsupported",
  message: "Mac compatibility tools are only available on macOS.",
  environment: null,
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
};

const toGameKey = (
  shop: string,
  objectId: string
): MacCompatibilityGameKey => ({
  shop: shop as GameShop,
  objectId,
});

/**
 * Creates the environment when it is missing, tests it for real, and only
 * repairs when the test actually failed. Exported so the flow can be
 * tested without Electron.
 */
export const runMacFixEverything = async (
  manager: MacCompatibilityManagerLike,
  game: MacCompatibilityGameKey,
  isWindowsGame: boolean
): Promise<MacCompatibilityActionResult> => {
  if (!isWindowsGame) {
    return {
      success: true,
      status: "ready",
      message: "This is a native macOS game, so no setup is needed.",
      environment: null,
    };
  }

  try {
    let environment = await manager.getGameEnvironment(game);

    if (!environment) {
      environment = await manager.createGameEnvironment(game);
    }

    let healthy = await manager.testGameEnvironment(game);

    if (!healthy) {
      await manager.repairGameEnvironment(game);
      healthy = await manager.testGameEnvironment(game);
    }

    environment = await manager.getGameEnvironment(game);

    return {
      success: healthy,
      status: healthy ? "ready" : "needs_repair",
      message: healthy
        ? "Everything is set up and working."
        : "The environment is still not working. Try repairing it again.",
      environment,
    };
  } catch (error) {
    logger.error("Failed to fix Mac compatibility for game", { game, error });

    return {
      success: false,
      status: "error",
      message: errorMessage(error),
      environment: null,
    };
  }
};

const createMacGameEnvironment = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: string,
  objectId: string
): Promise<MacCompatibilityActionResult> => {
  if (!isMacCompatibilitySupported()) return unsupportedResult;

  const game = toGameKey(shop, objectId);

  try {
    const environment =
      await getMacCompatibilityManager().createGameEnvironment(game);

    return {
      success: true,
      status: "ready",
      message: "The Windows environment was created.",
      environment,
    };
  } catch (error) {
    logger.error("Failed to create Mac game environment", { game, error });

    return {
      success: false,
      status: "error",
      message: errorMessage(error),
      environment: null,
    };
  }
};

const testMacGameEnvironment = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: string,
  objectId: string
): Promise<MacCompatibilityActionResult> => {
  if (!isMacCompatibilitySupported()) return unsupportedResult;

  const game = toGameKey(shop, objectId);
  const manager = getMacCompatibilityManager();

  try {
    const healthy = await manager.testGameEnvironment(game);
    const environment = await manager.getGameEnvironment(game);

    return {
      success: healthy,
      status: healthy ? "ready" : environment ? "needs_repair" : "needs_setup",
      message: healthy
        ? "The environment was tested and it works."
        : environment
          ? "The test failed. This environment needs a repair."
          : "There is no environment yet. Create one first.",
      environment,
    };
  } catch (error) {
    logger.error("Failed to test Mac game environment", { game, error });

    return {
      success: false,
      status: "error",
      message: errorMessage(error),
      environment: null,
    };
  }
};

const repairMacGameEnvironment = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: string,
  objectId: string
): Promise<MacCompatibilityActionResult> => {
  if (!isMacCompatibilitySupported()) return unsupportedResult;

  const game = toGameKey(shop, objectId);

  try {
    const environment =
      await getMacCompatibilityManager().repairGameEnvironment(game);

    return {
      success: true,
      status: "ready",
      message: "The environment was repaired and tested.",
      environment,
    };
  } catch (error) {
    logger.error("Failed to repair Mac game environment", { game, error });

    return {
      success: false,
      status: "needs_repair",
      message: errorMessage(error),
      environment: null,
    };
  }
};

const deleteMacGameEnvironment = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: string,
  objectId: string
): Promise<MacCompatibilityActionResult> => {
  if (!isMacCompatibilitySupported()) return unsupportedResult;

  const game = toGameKey(shop, objectId);

  try {
    const deleted =
      await getMacCompatibilityManager().deleteGameEnvironment(game);

    return {
      success: deleted,
      status: "needs_setup",
      message: deleted
        ? "The environment was deleted."
        : "There was no environment to delete.",
      environment: null,
    };
  } catch (error) {
    logger.error("Failed to delete Mac game environment", { game, error });

    return {
      success: false,
      status: "error",
      message: errorMessage(error),
      environment: null,
    };
  }
};

const fixMacGameEverything = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: string,
  objectId: string,
  isWindowsGame: boolean
): Promise<MacCompatibilityActionResult> => {
  if (!isMacCompatibilitySupported()) return unsupportedResult;

  return runMacFixEverything(
    getMacCompatibilityManager(),
    toGameKey(shop, objectId),
    isWindowsGame
  );
};

registerEvent("createMacGameEnvironment", createMacGameEnvironment);
registerEvent("testMacGameEnvironment", testMacGameEnvironment);
registerEvent("repairMacGameEnvironment", repairMacGameEnvironment);
registerEvent("deleteMacGameEnvironment", deleteMacGameEnvironment);
registerEvent("fixMacGameEverything", fixMacGameEverything);
