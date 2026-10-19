import { registerEvent } from "../register-event";
import { addDownloadSource } from "@main/services/add-download-source";

registerEvent("addDownloadSource", (_event, url: string) =>
  addDownloadSource(url)
);
