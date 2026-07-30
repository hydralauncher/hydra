import { runAutomaticCloudSaveSync } from "@main/services/cloud-save";
import { isGameRunning } from "@main/services/process-watcher";
import type { GameShop, SyncCloudSaveOnGamePageResult } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "syncCloudSaveOnGamePage",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop
  ): Promise<SyncCloudSaveOnGamePageResult> => {
    if (isGameRunning(objectId, shop)) {
      return { accepted: false, reason: "game-running" };
    }

    const result = await runAutomaticCloudSaveSync(
      objectId,
      shop,
      "game-page-open"
    );

    return { accepted: true, result };
  }
);
