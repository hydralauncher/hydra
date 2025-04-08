import { DownloadManager, Ludusavi, startMainLoop } from "./services";
import { RealDebridClient } from "./services/download/real-debrid";
import { HydraApi } from "./services/hydra-api";
import { uploadGamesBatch } from "./services/library-sync";
import { Aria2 } from "./services/aria2";
import { downloadsSublevel } from "./level/sublevels/downloads";
import { sortBy } from "lodash-es";
import { Downloader } from "@shared";
import { levelKeys, db } from "./level";
import type { UserPreferences } from "@types";
import { TorBoxClient } from "./services/download/torbox";
import { CommonRedistManager } from "./services/common-redist-manager";

export const loadState = async () => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  await import("./events");

  Aria2.spawn();

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences.realDebridApiToken);
  }

  if (userPreferences?.torBoxApiToken) {
    TorBoxClient.authorize(userPreferences.torBoxApiToken);
  }

  Ludusavi.addManifestToLudusaviConfig();

  HydraApi.setupApi().then(() => {
    uploadGamesBatch();
  });

  const downloads = await downloadsSublevel
    .values()
    .all()
    .then((games) => {
      return sortBy(games, "timestamp", "DESC");
    });

  downloads.forEach((download) => {
    if (download.extracting) {
      downloadsSublevel.put(levelKeys.game(download.shop, download.objectId), {
        ...download,
        extracting: false,
      });
    }
  });

  const [nextItemOnQueue] = downloads.filter((game) => game.queued);

  const downloadsToSeed = downloads.filter(
    (game) =>
      game.shouldSeed &&
      game.downloader === Downloader.Torrent &&
      game.progress === 1 &&
      game.uri !== null
  );

  await DownloadManager.startRPC(nextItemOnQueue, downloadsToSeed);

  startMainLoop();

  CommonRedistManager.downloadCommonRedist();
};
