import { registerEvent } from "../register-event";
import { rssFeedsSublevel } from "@main/level";
import type { RssFeed } from "@types";

const getRssFeeds = async (_event: Electron.IpcMainInvokeEvent) => {
  const feeds: RssFeed[] = [];
  for await (const value of rssFeedsSublevel.values()) {
    feeds.push(value);
  }
  return feeds;
};

registerEvent("getRssFeeds", getRssFeeds);
