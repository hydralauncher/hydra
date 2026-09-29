import {
  assertCloudSaveDeletionInactive,
  assertCloudSaveSubscription,
  getCloudSaveGameContext,
  isCloudSaveSyncActive,
} from "@main/services/cloud-save";
import { getEmulatorSaveProvider } from "@main/services/cloud-save/emulator-save-provider";
import { removeEmulatorCardPathOverride } from "@main/services/cloud-save/emulator-card-path-store";
import { isGameRunning } from "@main/services/process-watcher";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "removeEmulatorCardPathOverride",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    slot: string
  ) => {
    assertCloudSaveSubscription();
    if (
      isGameRunning(objectId, shop) ||
      isCloudSaveSyncActive(objectId, shop)
    ) {
      throw new Error("cloud_save_emulator_card_source_busy");
    }
    assertCloudSaveDeletionInactive(objectId, shop);
    const { game } = await getCloudSaveGameContext(objectId, shop);
    const provider = getEmulatorSaveProvider(game);
    if (
      !game ||
      (provider !== "duckstation" &&
        provider !== "pcsx2" &&
        provider !== "dolphin")
    ) {
      throw new Error("cloud_save_emulator_card_source_invalid");
    }
    await removeEmulatorCardPathOverride(game, provider, slot);
  }
);
