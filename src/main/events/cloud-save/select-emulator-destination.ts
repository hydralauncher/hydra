import { BrowserWindow, dialog } from "electron";

import {
  assertCloudSaveDeletionInactive,
  assertCloudSaveSubscription,
  isCloudSaveSyncActive,
} from "@main/services/cloud-save";
import { analyzeCloudSaveState } from "@main/services/cloud-save/analyze-cloud-save-state";
import {
  emulatorDestinationKindForFile,
  registerEmulatorDestinationBinding,
  type EmulatorDestinationKind,
} from "@main/services/cloud-save/emulator-destination-store";
import { getEmulatorSaveProvider } from "@main/services/cloud-save/emulator-save-provider";
import { isGameRunning } from "@main/services/process-watcher";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

const assertIdle = (objectId: string, shop: GameShop) => {
  if (isGameRunning(objectId, shop) || isCloudSaveSyncActive(objectId, shop)) {
    throw new Error("cloud_save_emulator_destination_busy");
  }
  assertCloudSaveDeletionInactive(objectId, shop);
};

registerEvent(
  "selectEmulatorDestination",
  async (
    event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    rawPath: string,
    kind: EmulatorDestinationKind
  ) => {
    assertCloudSaveSubscription();
    if (kind !== "save" && kind !== "state") {
      throw new Error("cloud_save_emulator_destination_invalid");
    }
    assertIdle(objectId, shop);
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const owner =
      senderWindow && !senderWindow.isDestroyed()
        ? senderWindow
        : WindowManager.mainWindow;
    if (!owner)
      throw new Error("cloud_save_emulator_destination_window_missing");

    const selection = await dialog.showOpenDialog(owner, {
      properties: ["openDirectory", "dontAddToRecent"],
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || !selectedPath) return { canceled: true };

    assertIdle(objectId, shop);
    const analysis = await analyzeCloudSaveState(objectId, shop);
    const game = analysis.context.game;
    const provider = getEmulatorSaveProvider(game);
    const matchingFile = analysis.remoteManifest?.files.find(
      (file) =>
        file.rawPath === rawPath &&
        emulatorDestinationKindForFile(file.rawPath, file.relativePath) === kind
    );
    if (!game || !provider || !matchingFile) {
      throw new Error("cloud_save_emulator_destination_invalid");
    }
    await registerEmulatorDestinationBinding(
      game,
      rawPath,
      kind,
      selectedPath,
      matchingFile.relativePath
    );
    return { canceled: false };
  }
);
