import { downloadSourceRepository } from "@main/repository";
import { registerEvent } from "../register-event";

const getDownloadSources = async (_event: Electron.IpcMainInvokeEvent) =>
  downloadSourceRepository.find({
    order: {
      createdAt: "DESC",
    },
  });

registerEvent("getDownloadSources", getDownloadSources);
