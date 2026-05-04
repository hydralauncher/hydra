import { registerEvent } from "../register-event";
import { rssFeedsSublevel } from "@main/level";
import { v4 as uuidv4 } from "uuid";
import type { RssFeed } from "@types";

const addRssFeed = async (
  _event: Electron.IpcMainInvokeEvent,
  name: string,
  url: string
) => {
  const id = uuidv4();
  const feed: RssFeed = {
    id,
    name,
    url,
    createdAt: new Date().toISOString(),
  };

  await rssFeedsSublevel.put(id, feed);
  return feed;
};

registerEvent("addRssFeed", addRssFeed);
