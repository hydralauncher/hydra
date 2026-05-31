import { registerEvent } from "../register-event";
import { levelKeys, ps2MemoryCardSavesSublevel } from "@main/level";
import type { Ps2MemoryCardSaveRecord } from "@types";

const listPs2MemcardSaves = async (): Promise<Ps2MemoryCardSaveRecord[]> => {
  const records = await ps2MemoryCardSavesSublevel.values().all();
  return records.sort(
    (a, b) =>
      a.cardLabel.localeCompare(b.cardLabel) ||
      (a.title ?? a.folderName).localeCompare(b.title ?? b.folderName)
  );
};

// "Forget" removes the save from Hydra's list only — the card file is untouched.
const forgetPs2MemcardSave = async (
  _event: Electron.IpcMainInvokeEvent,
  cardFilePath: string,
  folderName: string
) => {
  await ps2MemoryCardSavesSublevel.del(
    levelKeys.ps2MemoryCardSave(cardFilePath, folderName)
  );
};

registerEvent("listPs2MemcardSaves", listPs2MemcardSaves);
registerEvent("forgetPs2MemcardSave", forgetPs2MemcardSave);
