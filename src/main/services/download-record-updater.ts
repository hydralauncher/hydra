import { downloadsSublevel } from "@main/level";
import { createDownloadRecordUpdater } from "./download-record-updater-core";

export const updateDownloadRecord =
  createDownloadRecordUpdater(downloadsSublevel);
