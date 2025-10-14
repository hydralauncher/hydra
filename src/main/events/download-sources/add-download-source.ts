import { registerEvent } from "../register-event";
import { downloadSourcesSublevel } from "@main/level";
import { HydraApi } from "@main/services";
import { importDownloadSourceToLocal } from "./helpers";

const addDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  const result = await importDownloadSourceToLocal(url, true);
  if (!result) {
    throw new Error("Failed to import download source");
  }

  await HydraApi.post("/profile/download-sources", {
    urls: [url],
  });

  const { fingerprint } = await HydraApi.put<{ fingerprint: string }>(
    "/download-sources",
    {
      objectIds: result.objectIds,
    },
    { needsAuth: false }
  );

  const updatedSource = await downloadSourcesSublevel.get(`${result.id}`);
  if (updatedSource) {
    await downloadSourcesSublevel.put(`${result.id}`, {
      ...updatedSource,
      fingerprint,
      updatedAt: new Date(),
    });
  }

  return {
    ...result,
    fingerprint,
  };
};

registerEvent("addDownloadSource", addDownloadSource);
