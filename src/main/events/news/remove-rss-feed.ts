import { registerEvent } from "../register-event";
import { rssFeedsSublevel } from "@main/level";

const removeRssFeed = async (
  _event: Electron.IpcMainInvokeEvent,
  feedId: string
) => {
  await rssFeedsSublevel.del(feedId);
};

registerEvent("removeRssFeed", removeRssFeed);
