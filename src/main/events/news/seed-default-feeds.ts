import { registerEvent } from "../register-event";
import { rssFeedsSublevel } from "@main/level";
import { v4 as uuidv4 } from "uuid";
import type { RssFeed } from "@types";

const defaultFeeds = [
  { name: "PC Gamer", url: "https://www.pcgamer.com/rss/" },
  { name: "IGN", url: "https://feeds.feedburner.com/ign/all" },
  { name: "Kotaku", url: "https://kotaku.com/rss" },
  { name: "Eurogamer", url: "https://www.eurogamer.net/feed" },
  {
    name: "Rock Paper Shotgun",
    url: "https://www.rockpapershotgun.com/feed",
  },
  { name: "GameSpot", url: "https://www.gamespot.com/feeds/mashup/" },
  { name: "Polygon", url: "https://www.polygon.com/rss/index.xml" },
];

const seedDefaultFeeds = async (_event: Electron.IpcMainInvokeEvent) => {
  const existing: RssFeed[] = [];
  for await (const value of rssFeedsSublevel.values()) {
    existing.push(value);
  }

  if (existing.length > 0) return;

  for (const feed of defaultFeeds) {
    const id = uuidv4();
    await rssFeedsSublevel.put(id, {
      id,
      name: feed.name,
      url: feed.url,
      createdAt: new Date().toISOString(),
    });
  }
};

registerEvent("seedDefaultFeeds", seedDefaultFeeds);
