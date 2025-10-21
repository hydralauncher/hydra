import { db } from "../level";
import { levelKeys } from "./keys";
import type { DownloadSource } from "@types";

export const downloadSourcesSublevel = db.sublevel<string, DownloadSource>(
  levelKeys.downloadSources,
  {
    valueEncoding: "json",
  }
);
