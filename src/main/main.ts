import { stateManager } from "./state-manager";
import { repackers } from "./constants";
import {
  getNewGOGGames,
  getNewRepacksFromCPG,
  getNewRepacksFromUser,
  getNewRepacksFromXatab,
  // getNewRepacksFromOnlineFix,
  readPipe,
  startProcessWatcher,
  writePipe,
} from "./services";
import {
  gameRepository,
  repackRepository,
  repackerFriendlyNameRepository,
  steamGameRepository,
  userPreferencesRepository,
} from "./repository";
import { TorrentClient } from "./services/donwloaders/torrent-client";
import { Repack } from "./entity";
import { Notification } from "electron";
import { t } from "i18next";
import { In } from "typeorm";
import { Downloader } from "./services/donwloaders/downloader";
import { GameStatus } from "@globals";

startProcessWatcher();

TorrentClient.startTorrentClient(writePipe.socketPath, readPipe.socketPath);

Promise.all([writePipe.createPipe(), readPipe.createPipe()]).then(async () => {
  const game = await gameRepository.findOne({
    where: {
      status: In([
        GameStatus.Downloading,
        GameStatus.DownloadingMetadata,
        GameStatus.CheckingFiles,
      ]),
    },
    relations: { repack: true },
  });

  if (game) {
    Downloader.downloadGame(game, game.repack);
  }

  readPipe.socket?.on("data", (data) => {
    TorrentClient.onSocketData(data);
  });
});

const track1337xUsers = async (existingRepacks: Repack[]) => {
  for (const repacker of repackers) {
    await getNewRepacksFromUser(
      repacker,
      existingRepacks.filter((repack) => repack.repacker === repacker)
    );
  }
};

const checkForNewRepacks = async () => {
  const userPreferences = await userPreferencesRepository.findOne({
    where: { id: 1 },
  });

  const existingRepacks = stateManager.getValue("repacks");

  Promise.allSettled([
    getNewGOGGames(
      existingRepacks.filter((repack) => repack.repacker === "GOG")
    ),
    getNewRepacksFromXatab(
      existingRepacks.filter((repack) => repack.repacker === "Xatab")
    ),
    getNewRepacksFromCPG(
      existingRepacks.filter((repack) => repack.repacker === "CPG")
    ),
    // getNewRepacksFromOnlineFix(
    //   existingRepacks.filter((repack) => repack.repacker === "onlinefix")
    // ),
    track1337xUsers(existingRepacks),
  ]).then(() => {
    repackRepository.count().then((count) => {
      const total = count - stateManager.getValue("repacks").length;

      if (total > 0 && userPreferences?.repackUpdatesNotificationsEnabled) {
        new Notification({
          title: t("repack_list_updated", {
            ns: "notifications",
            lng: userPreferences?.language || "en",
          }),
          body: t("repack_count", {
            ns: "notifications",
            lng: userPreferences?.language || "en",
            count: total,
          }),
        }).show();
      }
    });
  });
};

const loadState = async () => {
  const [friendlyNames, repacks, steamGames] = await Promise.all([
    repackerFriendlyNameRepository.find(),
    repackRepository.find({
      order: {
        createdAt: "desc",
      },
    }),
    steamGameRepository.find({
      order: {
        name: "asc",
      },
    }),
  ]);

  stateManager.setValue("repackersFriendlyNames", friendlyNames);
  stateManager.setValue("repacks", repacks);
  stateManager.setValue("steamGames", steamGames);

  import("./events");
};

loadState().then(() => checkForNewRepacks());
