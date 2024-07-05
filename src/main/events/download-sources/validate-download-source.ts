import { registerEvent } from "../register-event";
import { downloadSourceRepository } from "@main/repository";
import { RepacksManager } from "@main/services";
import { downloadSourceWorker } from "@main/workers";

const validateDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
) => {
  const existingSource = await downloadSourceRepository.findOne({
    where: { url },
  });

  if (existingSource)
    throw new Error("Source with the same url already exists");

  const repacks = RepacksManager.repacks;

  return downloadSourceWorker.run(
    { url, repacks },
    {
      name: "validateDownloadSource",
    }
  );
};

registerEvent("validateDownloadSource", validateDownloadSource);
