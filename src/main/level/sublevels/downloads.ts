import type { Download } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const downloadsSublevel = db.sublevel<string, Download>(
  levelKeys.downloads,
  {
    valueEncoding: "json",
  }
);
