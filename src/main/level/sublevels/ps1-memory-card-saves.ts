import type { MemoryCardSaveRecord } from "@types";
import { db } from "../level";
import { levelKeys } from "./keys";

// Saves detected inside PS1 (DuckStation) memory cards. Kept separate from both
// the games library and the PS2 store. Keyed by `${cardFilePath}::${identifier}`.
export const ps1MemoryCardSavesSublevel = db.sublevel<
  string,
  MemoryCardSaveRecord
>(levelKeys.ps1MemoryCardSaves, {
  valueEncoding: "json",
});
