import type { DownloadLayoutState } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const downloadLayoutStateSublevel = db.sublevel<
  string,
  DownloadLayoutState
>(levelKeys.downloadLayoutState, {
  valueEncoding: "json",
});
