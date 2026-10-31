import type { Game } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";

export const assertLegacyCloudSaveWriteAllowed = (
  game: Pick<Game, "shop" | "platform"> | null | undefined
) => {
  if (game && getCloudSaveEmulatorProvider(game.shop, game.platform)) {
    throw new Error("cloud_save_legacy_read_only");
  }
};
