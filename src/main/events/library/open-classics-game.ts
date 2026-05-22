import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { launchClassicsGame, platformToSystem } from "@main/helpers";
import { logger } from "@main/services";
import type { GameShop } from "@types";

const openClassicsGame = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  discPath?: string
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
