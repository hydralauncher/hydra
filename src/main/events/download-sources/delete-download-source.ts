import { registerEvent } from "../register-event";
import { downloadSourcesSublevel, repacksSublevel } from "@main/level";
import { invalidateIdCaches } from "./helpers";

const deleteDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  id: number
) => {
  const repacksToDelete: string[] = [];

  for await (const [key, repack] of repacksSublevel.iterator()) {
    if (repack.downloadSourceId === id) {
      repacksToDelete.push(key);
    }
  }

  const batch = repacksSublevel.batch();
  for (const key of repacksToDelete) {
    batch.del(key);
  }
  await batch.write();

  await downloadSourcesSublevel.del(`${id}`);

  invalidateIdCaches();
};

registerEvent("deleteDownloadSource", deleteDownloadSource);
