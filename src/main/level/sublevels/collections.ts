import type { Collection } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const collectionsSublevel = db.sublevel<string, Collection>(
  levelKeys.collections,
  {
    valueEncoding: "json",
  }
);
