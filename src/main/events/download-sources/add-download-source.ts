import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services/hydra-api";
import { downloadSourcesSublevel } from "@main/level";
import type { DownloadSource } from "@types";

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
        console.error("Failed to add download source to profile:", error);
      }
    }

    const downloadSourceForStorage = {
      ...downloadSource,
      fingerprint: downloadSource.fingerprint || "",
    };
    await downloadSourcesSublevel.put(
      downloadSource.id,
      downloadSourceForStorage
    );

    return downloadSource;
  } catch (error) {
    console.error("Failed to add download source:", error);
    throw error;
  }
};

registerEvent("addDownloadSource", addDownloadSource);
