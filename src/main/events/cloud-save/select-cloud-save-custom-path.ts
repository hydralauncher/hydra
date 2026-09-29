import { BrowserWindow, dialog } from "electron";

import {
  assertCloudSaveSubscription,
  assertCloudSaveCustomPathDoesNotOverlap,
  assertCloudSaveCustomPathHasEligibleFiles,
  assertCloudSaveDeletionInactive,
  canonicalizeSelectedCloudSaveCustomPath,
  cloudSaveCustomPathContextFromPathContext,
  getCloudSaveGameContext,
  isCloudSaveSyncActive,
  registerCloudSaveCustomPathWithoutOverlap,
} from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import { assertCloudSaveCustomPathKindAllowed } from "@main/services/cloud-save/custom-path-selection-policy";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop, SelectCloudSaveCustomPathResult } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "selectCloudSaveCustomPath",
  async (
    event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    kind: "file" | "dir" = "dir"
  ): Promise<SelectCloudSaveCustomPathResult> => {
    assertCloudSaveSubscription();
    if (kind !== "file" && kind !== "dir") {
      throw new Error("cloud_save_custom_path_invalid_kind");
    }
    if (isGameRunning(objectId, shop)) {
      throw new Error("cloud_save_custom_path_game_running");
    }
    if (isCloudSaveSyncActive(objectId, shop)) {
      throw new Error("cloud_save_custom_path_sync_active");
    }
    assertCloudSaveDeletionInactive(objectId, shop);

    if (kind === "file") {
      const context = await getCloudSaveGameContext(objectId, shop);
      assertCloudSaveCustomPathKindAllowed(kind, shop, context.game?.platform);
    }

    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const owner =
      senderWindow && !senderWindow.isDestroyed()
        ? senderWindow
        : WindowManager.mainWindow;
    if (!owner) throw new Error("Main window is not available");

    const selection = await dialog.showOpenDialog(owner, {
      properties: [
        kind === "file" ? "openFile" : "openDirectory",
        "dontAddToRecent",
      ],
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || !selectedPath) return { canceled: true };

    if (isGameRunning(objectId, shop)) {
      throw new Error("cloud_save_custom_path_game_running");
    }
    if (isCloudSaveSyncActive(objectId, shop)) {
      throw new Error("cloud_save_custom_path_sync_active");
    }
    assertCloudSaveDeletionInactive(objectId, shop);

    const context = await getCloudSaveGameContext(objectId, shop);
    assertCloudSaveCustomPathKindAllowed(kind, shop, context.game?.platform);
    const customPathContext = cloudSaveCustomPathContextFromPathContext(
      context.pathContext
    );
    const customPath = await canonicalizeSelectedCloudSaveCustomPath(
      selectedPath,
      customPathContext,
      kind
    );
    await assertCloudSaveCustomPathDoesNotOverlap({
      objectId,
      shop,
      selectedPath: customPath.path,
      context,
    });
    await assertCloudSaveCustomPathHasEligibleFiles(
      objectId,
      shop,
      context,
      customPath
    );
    await registerCloudSaveCustomPathWithoutOverlap({
      objectId,
      shop,
      customPath,
      context,
      syncState: "pending",
      assertCanRegister: () => {
        if (isGameRunning(objectId, shop)) {
          throw new Error("cloud_save_custom_path_game_running");
        }
        if (isCloudSaveSyncActive(objectId, shop)) {
          throw new Error("cloud_save_custom_path_sync_active");
        }
        assertCloudSaveDeletionInactive(objectId, shop);
      },
    });
    return { canceled: false, customPath };
  }
);
