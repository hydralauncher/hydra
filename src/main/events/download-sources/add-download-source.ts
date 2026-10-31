import { registerEvent } from "../register-event";
import { addDownloadSource } from "@main/services/add-download-source";
import { downloadSourceOperationGate } from "@main/services/download-source-operation-gate";

registerEvent("addDownloadSource", (_event, url: string) =>
  downloadSourceOperationGate.run(() => addDownloadSource(url))
);
