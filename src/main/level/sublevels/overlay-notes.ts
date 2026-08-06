import { db } from "../level";
import { levelKeys } from "./keys";

export const overlayNotesSublevel = db.sublevel<string, string>(
  levelKeys.overlayNotes,
  { valueEncoding: "utf8" }
);
