import { registerEvent } from "../register-event";
import { downloadSourcesSublevel, DownloadSource } from "@main/level";

const getDownloadSourcesList = async (_event: Electron.IpcMainInvokeEvent) => {
  const sources: DownloadSource[] = [];

  for await (const [, source] of downloadSourcesSublevel.iterator()) {
    sources.push(source);
  }

  // Sort by createdAt descending
  sources.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return sources;
};

registerEvent("getDownloadSourcesList", getDownloadSourcesList);
