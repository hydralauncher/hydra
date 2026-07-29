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
    approvalId: string
  ): Promise<SelectCloudSaveCustomPathApprovalResult> => {
    assertCloudSaveSubscription();
    const approval = getPendingCloudSaveCustomPathApprovalById(approvalId);
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
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || !selectedPath) {
      return { canceled: true, approval };
    }

    return {
      canceled: false,
      approval: await selectPendingCloudSaveCustomPathApproval(
        approvalId,
        selectedPath
      ),
    };
  }
);
