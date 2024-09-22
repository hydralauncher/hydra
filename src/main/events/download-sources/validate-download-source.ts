import { registerEvent } from "../register-event";
import { downloadSourcesWorker } from "@main/workers";

const validateDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) =>
  downloadSourcesWorker.run(url, {
    name: "validateDownloadSource",
  });

registerEvent("validateDownloadSource", validateDownloadSource);
