import { downloadSourceRepository, repackRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { repacksWorker } from "@main/workers";

const removeDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number
) => {
  await downloadSourceRepository.delete(id);

  repackRepository
    .find({
      order: {
        createdAt: "DESC",
      },
    })
    .then((repacks) => {
      repacksWorker.run(repacks, { name: "setRepacks" });
    });
};

registerEvent("removeDownloadSource", removeDownloadSource);
