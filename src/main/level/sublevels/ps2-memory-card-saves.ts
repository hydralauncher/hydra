import type { Ps2MemoryCardSaveRecord } from "@types";
import { db } from "../level";
import { levelKeys } from "./keys";

// Saves detected inside PS2 memory cards. Kept separate from the games library:
// a memory-card save is not a launchable disc. Keyed by `${cardFilePath}::${folderName}`.
export const ps2MemoryCardSavesSublevel = db.sublevel<
  string,
  Ps2MemoryCardSaveRecord
>(levelKeys.ps2MemoryCardSaves, {
  valueEncoding: "json",
});
