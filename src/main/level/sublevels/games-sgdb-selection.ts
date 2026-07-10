import type { SgdbSelectionRecord } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const gamesSgdbSelectionSublevel = db.sublevel<
  string,
  SgdbSelectionRecord
>(levelKeys.sgdbSelection, {
  valueEncoding: "json",
});
