import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import { downloadSourcesSublevel } from "@main/level";
import type { DownloadSource } from "@types";
import { logger } from "@main/services";

const addDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  try {
    const downloadSource = await HydraApi.post<DownloadSource>(
      "/download-sources",
      {
        url,
      },
      { needsAuth: false }
    );

    if (HydraApi.isLoggedIn()) {
      try {
        await HydraApi.post("/profile/download-sources", {
          urls: [url],
        });
      } catch (error) {
        logger.error("Failed to add download source to profile:", error);
      }
    }

    await downloadSourcesSublevel.put(downloadSource.id, {
      ...downloadSource,
      isRemote: true,
      createdAt: new Date().toISOString(),
    });

    return downloadSource;
  } catch (error) {
    logger.error("Failed to add download source:", error);
    throw error;
  }
};

registerEvent("addDownloadSource", addDownloadSource);
