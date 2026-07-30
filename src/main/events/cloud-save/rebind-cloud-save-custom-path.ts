import { BrowserWindow, dialog } from "electron";

import {
  assertCloudSaveSubscription,
  bindCloudSaveCustomPathToLocalPath,
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  getCloudSaveGameContext,
  getCloudSaveV2FileDetails,
  isCloudSaveSyncActive,
  registerCloudSaveCustomPaths,
} from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop, SelectCloudSaveCustomPathResult } from "@types";

import { registerEvent } from "../register-event";

const assertCustomPathCanBeRebound = async (
  objectId: string,
  shop: GameShop,
  rawPath: string
) => {
  if (!rawPath.startsWith("<custom>")) {
    throw new Error("cloud_save_custom_path_invalid");
  }
  const details = await getCloudSaveV2FileDetails(objectId, shop);
  const isKnown =
    details.customPaths.some((path) => path.rawPath === rawPath) ||
    details.unresolvedCustomPaths.some((path) => path.rawPath === rawPath);
  if (!isKnown) throw new Error("cloud_save_custom_path_not_registered");
};

const assertCustomPathCanChange = (objectId: string, shop: GameShop) => {
  if (isGameRunning(objectId, shop)) {
    throw new Error("cloud_save_custom_path_game_running");
  }
  if (isCloudSaveSyncActive(objectId, shop)) {
    throw new Error("cloud_save_custom_path_sync_active");
  }
};

registerEvent(
  "rebindCloudSaveCustomPath",
  async (
    event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    rawPath: string
  ): Promise<SelectCloudSaveCustomPathResult> => {
    assertCloudSaveSubscription();
    assertCustomPathCanChange(objectId, shop);
    await assertCustomPathCanBeRebound(objectId, shop, rawPath);

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

    assertCustomPathCanChange(objectId, shop);
    await assertCustomPathCanBeRebound(objectId, shop, rawPath);

    const { pathContext } = await getCloudSaveGameContext(objectId, shop);
    const customPathContext =
      cloudSaveCustomPathContextFromPathContext(pathContext);
    const selected = await canonicalizeSelectedCloudSaveCustomPath(
      selectedPath,
      customPathContext
    );
    const customPath = bindCloudSaveCustomPathToLocalPath(
      rawPath,
      selected.path,
      customPathContext
    );
    assertCustomPathCanChange(objectId, shop);
    await registerCloudSaveCustomPaths(shop, objectId, [customPath]);
    return { canceled: false, customPath };
  }
);
