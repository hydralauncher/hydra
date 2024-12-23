import { HydraApi } from "@main/services";
import { registerEvent } from "../register-event";

const putDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  objectIds: string[]
) => {
  return HydraApi.put<{ fingerprint: string }>(
    "/download-sources",
    {
      objectIds,
    },
    { needsAuth: false }
  );
};

registerEvent("putDownloadSource", putDownloadSource);
