import type { PlayLaterEntry } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const playLaterSublevel = db.sublevel<string, PlayLaterEntry>(
  levelKeys.playLater,
  {
    valueEncoding: "json",
  }
);
