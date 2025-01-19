import { DownloadManager, Ludusavi, startMainLoop } from "./services";
import { userPreferencesRepository } from "./repository";
import { UserPreferences } from "./entity";
import { RealDebridClient } from "./services/download/real-debrid";
import { HydraApi } from "./services/hydra-api";
import { uploadGamesBatch } from "./services/library-sync";
import { Aria2 } from "./services/aria2";
import { downloadsSublevel } from "./level/sublevels/downloads";
import { sortBy } from "lodash-es";
import { Downloader } from "@shared";

const loadState = async (userPreferences: UserPreferences | null) => {
  import("./events");

  Aria2.spawn();

  if (userPreferences?.realDebridApiToken) {
    RealDebridClient.authorize(userPreferences?.realDebridApiToken);
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

  const [nextItemOnQueue] = downloads;

  const downloadsToSeed = downloads.filter(
    (download) =>
      download.shouldSeed &&
      download.downloader === Downloader.Torrent &&
      download.progress === 1 &&
      download.uri !== null
  );

  await DownloadManager.startRPC(nextItemOnQueue, downloadsToSeed);

  startMainLoop();
};

userPreferencesRepository
  .findOne({
    where: { id: 1 },
  })
  .then((userPreferences) => {
    loadState(userPreferences);
  });
