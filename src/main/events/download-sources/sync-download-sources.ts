import { downloadSourcesWorker } from "@main/workers";
import { registerEvent } from "../register-event";
import type { DownloadSource } from "@types";

const syncDownloadSources = async (
  _event: Electron.IpcMainInvokeEvent,
  downloadSources: DownloadSource[]
) =>
  downloadSourcesWorker.run(downloadSources, {
    name: "getUpdatedRepacks",
  });

registerEvent("syncDownloadSources", syncDownloadSources);
