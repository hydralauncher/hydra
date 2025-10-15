import { db } from "../level";
import { levelKeys } from "./keys";

export interface DownloadSource {
  id: number;
  name: string;
  url: string;
  status: number;
  objectIds: string[];
  downloadCount: number;
  fingerprint?: string;
  etag: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const downloadSourcesSublevel = db.sublevel<string, DownloadSource>(
  levelKeys.downloadSources,
  {
    valueEncoding: "json",
  }
);
