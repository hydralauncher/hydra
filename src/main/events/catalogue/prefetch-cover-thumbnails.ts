import { registerEvent } from "../register-event";
import { prefetchCoverThumbnails } from "@main/services/cover-thumbnail";

const prefetchCoverThumbnailsEvent = (
  _event: Electron.IpcMainInvokeEvent,
  thumbnailUrls: unknown
) => {
  if (!Array.isArray(thumbnailUrls)) return;

  prefetchCoverThumbnails(
    thumbnailUrls.filter((item): item is string => typeof item === "string")
  );
};

registerEvent("prefetchCoverThumbnails", prefetchCoverThumbnailsEvent);
