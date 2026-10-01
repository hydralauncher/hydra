import {
  assertCloudSaveDeletionInactive,
  assertCloudSaveSubscription,
  getCloudSaveGameContext,
  isCloudSaveSyncActive,
} from "@main/services/cloud-save";
import {
  removeEmulatorDestinationBinding,
  type EmulatorDestinationKind,
} from "@main/services/cloud-save/emulator-destination-store";
import { getEmulatorSaveProvider } from "@main/services/cloud-save/emulator-save-provider";
import { isGameRunning } from "@main/services/process-watcher";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "removeEmulatorDestination",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    rawPath: string,
    kind: EmulatorDestinationKind
  ) => {
    assertCloudSaveSubscription();
    if (kind !== "save" && kind !== "state") {
      throw new Error("cloud_save_emulator_destination_invalid");
    }
    if (
      isGameRunning(objectId, shop) ||
      isCloudSaveSyncActive(objectId, shop)
    ) {
      throw new Error("cloud_save_emulator_destination_busy");
    }
    assertCloudSaveDeletionInactive(objectId, shop);
    const { game } = await getCloudSaveGameContext(objectId, shop);
    const provider = getEmulatorSaveProvider(game);
    if (!game || !provider) {
      throw new Error("cloud_save_emulator_destination_invalid");
    }
    await removeEmulatorDestinationBinding(game, rawPath, kind);
  }
);
