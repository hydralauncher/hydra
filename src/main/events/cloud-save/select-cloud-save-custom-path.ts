import { BrowserWindow, dialog } from "electron";
import { promises as fs } from "node:fs";
import { t } from "i18next";

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
import { manualCardSelectionFor } from "@main/services/cloud-save/emulator-card-manual-selection";
import { registerEmulatorCardPathOverride } from "@main/services/cloud-save/emulator-card-path-store";
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
    const cardSelection = manualCardSelectionFor(
      context.game,
      selectedPath,
      kind === "dir"
    );
    if (cardSelection && context.game) {
      const selectedStat = await fs.lstat(selectedPath);
      if (
        selectedStat.isSymbolicLink() ||
        (kind === "file" && !selectedStat.isFile()) ||
        (kind === "dir" && !selectedStat.isDirectory())
      ) {
        throw new Error("cloud_save_emulator_card_source_invalid");
      }
      const valid =
        cardSelection.provider === "duckstation"
          ? await (
              await import(
                "@main/services/cloud-save/duckstation-save-provider"
              )
            ).validateDuckstationManualCardForGame(context.game, selectedPath)
          : cardSelection.provider === "pcsx2"
            ? await (
                await import("@main/services/cloud-save/pcsx2-save-provider")
              ).validatePcsx2ManualCardForGame(context.game, selectedPath)
            : await (
                await import("@main/services/cloud-save/dolphin-save-provider")
              ).validateDolphinManualRawCard(context.game, selectedPath);
      if (!valid) throw new Error("cloud_save_emulator_card_game_mismatch");

      const choice = await dialog.showMessageBox(owner, {
        type: "question",
        title: t("cloud_save_v2_card_slot_title", { ns: "game_details" }),
        message: t("cloud_save_v2_card_slot_message", { ns: "game_details" }),
        buttons: [
          t("cancel", { ns: "game_details" }),
          ...cardSelection.slots.map((slot) =>
            t("cloud_save_v2_card_slot_option", {
              ns: "game_details",
              slot,
            })
          ),
        ],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (choice.response === 0) return { canceled: true };
      const slot = cardSelection.slots[choice.response - 1];
      if (!slot) throw new Error("cloud_save_emulator_card_slot_invalid");
      if (isGameRunning(objectId, shop)) {
        throw new Error("cloud_save_custom_path_game_running");
      }
      if (isCloudSaveSyncActive(objectId, shop)) {
        throw new Error("cloud_save_custom_path_sync_active");
      }
      assertCloudSaveDeletionInactive(objectId, shop);
      await registerEmulatorCardPathOverride(
        context.game,
        cardSelection.provider,
        await fs.realpath(selectedPath),
        slot
      );
      return { canceled: false, cardSourceAdded: true };
    }
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
