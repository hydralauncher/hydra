import { downloadsSublevel } from "./level/sublevels/downloads";
import { sortBy } from "lodash-es";
import { Downloader } from "@shared";
import { levelKeys, db } from "./level";
import type { UserPreferences } from "@types";
import {
  WSClient,
  SystemPath,
  CommonRedistManager,
  TorBoxClient,
  RealDebridClient,
  Aria2,
  DownloadManager,
  HydraApi,
  uploadGamesBatch,
  startMainLoop,
  Ludusavi,
} from "@main/services";

export const loadState = async () => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  await import("./events");

  if (process.platform !== "darwin") {
    Aria2.spawn();
  }

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences.realDebridApiToken);
  }

  if (userPreferences?.torBoxApiToken) {
    TorBoxClient.authorize(userPreferences.torBoxApiToken);
  }

  Ludusavi.copyConfigFileToUserData();

  await HydraApi.setupApi().then(() => {
    uploadGamesBatch();
    WSClient.connect();
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

  SystemPath.checkIfPathsAreAvailable();
};
