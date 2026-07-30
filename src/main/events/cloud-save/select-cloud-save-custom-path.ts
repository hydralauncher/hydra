import { BrowserWindow, dialog } from "electron";

import {
  assertCloudSaveSubscription,
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  getCloudSaveGameContext,
  isCloudSaveSyncActive,
  registerCloudSaveCustomPathWithoutOverlap,
} from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop, SelectCloudSaveCustomPathResult } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "selectCloudSaveCustomPath",
  async (
    event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ): Promise<SelectCloudSaveCustomPathResult> => {
    assertCloudSaveSubscription();
    if (isGameRunning(objectId, shop)) {
      throw new Error("cloud_save_custom_path_game_running");
    }
    if (isCloudSaveSyncActive(objectId, shop)) {
      throw new Error("cloud_save_custom_path_sync_active");
    }

    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const owner =
      senderWindow && !senderWindow.isDestroyed()
        ? senderWindow
        : WindowManager.mainWindow;
    if (!owner) throw new Error("Main window is not available");

    const selection = await dialog.showOpenDialog(owner, {
      properties: ["openDirectory", "dontAddToRecent"],
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || !selectedPath) return { canceled: true };

    if (isGameRunning(objectId, shop)) {
      throw new Error("cloud_save_custom_path_game_running");
    }
    if (isCloudSaveSyncActive(objectId, shop)) {
      throw new Error("cloud_save_custom_path_sync_active");
    }

    const context = await getCloudSaveGameContext(objectId, shop);
    const customPathContext = cloudSaveCustomPathContextFromPathContext(
      context.pathContext
    );
    const customPath = await canonicalizeSelectedCloudSaveCustomPath(
      selectedPath,
      customPathContext
    );
    await registerCloudSaveCustomPathWithoutOverlap({
      objectId,
      shop,
      customPath,
      context,
      assertCanRegister: () => {
        if (isGameRunning(objectId, shop)) {
          throw new Error("cloud_save_custom_path_game_running");
        }
        if (isCloudSaveSyncActive(objectId, shop)) {
          throw new Error("cloud_save_custom_path_sync_active");
        }
      },
    });
    return { canceled: false, customPath };
  }
);
