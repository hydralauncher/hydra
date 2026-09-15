import { db } from "../level";
import { levelKeys } from "./keys";
import type { DownloadSourceDownload } from "@types";

// Stores the raw downloads parsed from a local (file-based) source,
// keyed by the local source id.
export const localDownloadsSublevel = db.sublevel<
  string,
  DownloadSourceDownload[]
>(levelKeys.localDownloads, {
  valueEncoding: "json",
});
