import { registerEvent } from "../register-event";
import { levelKeys, ps1MemoryCardSavesSublevel } from "@main/level";
import type { MemoryCardSaveRecord } from "@types";

const listPs1MemcardSaves = async (): Promise<MemoryCardSaveRecord[]> => {
  const records = await ps1MemoryCardSavesSublevel.values().all();
  return records.sort(
    (a, b) =>
      a.cardLabel.localeCompare(b.cardLabel) ||
      (a.title ?? a.folderName).localeCompare(b.title ?? b.folderName)
  );
};

// "Forget" removes the save from Hydra's list only — the card file is untouched.
const forgetPs1MemcardSave = async (
  _event: Electron.IpcMainInvokeEvent,
  cardFilePath: string,
  identifier: string
) => {
  await ps1MemoryCardSavesSublevel.del(
    levelKeys.ps1MemoryCardSave(cardFilePath, identifier)
  );
};

// Forget every save belonging to one card. The card file is untouched.
const forgetPs1MemcardCard = async (
  _event: Electron.IpcMainInvokeEvent,
  cardFilePath: string
) => {
  const keys: string[] = [];
  for (const [key, rec] of await ps1MemoryCardSavesSublevel.iterator().all()) {
    if (rec.cardFilePath === cardFilePath) keys.push(key);
  }
  for (const key of keys) {
    await ps1MemoryCardSavesSublevel.del(key);
  }
};

registerEvent("listPs1MemcardSaves", listPs1MemcardSaves);
registerEvent("forgetPs1MemcardSave", forgetPs1MemcardSave);
registerEvent("forgetPs1MemcardCard", forgetPs1MemcardCard);
