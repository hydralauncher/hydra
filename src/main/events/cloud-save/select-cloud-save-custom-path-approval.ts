import { BrowserWindow, dialog } from "electron";

import {
  assertCloudSaveSubscription,
  getPendingCloudSaveCustomPathApprovalById,
  selectPendingCloudSaveCustomPathApproval,
} from "@main/services/cloud-save";
import { WindowManager } from "@main/services/window-manager";
import type { SelectCloudSaveCustomPathApprovalResult } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "selectCloudSaveCustomPathApproval",
  async (
    event: Electron.IpcMainInvokeEvent,
    approvalId: string,
    selectedPath?: string
  ): Promise<SelectCloudSaveCustomPathApprovalResult> => {
    assertCloudSaveSubscription();
    const approval = getPendingCloudSaveCustomPathApprovalById(approvalId);
    if (selectedPath !== undefined) {
      if (
        typeof selectedPath !== "string" ||
        selectedPath.trim().length === 0
      ) {
        throw new Error("Invalid cloud save custom path selection");
      }

      return {
        canceled: false,
        approval: await selectPendingCloudSaveCustomPathApproval(
          approvalId,
          selectedPath
        ),
      };
    }

    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const owner =
      senderWindow && !senderWindow.isDestroyed()
        ? senderWindow
        : WindowManager.mainWindow;
    if (!owner) throw new Error("Main window is not available");

    const selection = await dialog.showOpenDialog(owner, {
      properties: ["openDirectory", "dontAddToRecent"],
      defaultPath: approval.selectedPath ?? approval.suggestedPath ?? undefined,
    });
    const dialogSelectedPath = selection.filePaths[0];
    if (selection.canceled || !dialogSelectedPath) {
      return { canceled: true, approval };
    }

    return {
      canceled: false,
      approval: await selectPendingCloudSaveCustomPathApproval(
        approvalId,
        dialogSelectedPath
      ),
    };
  }
);
