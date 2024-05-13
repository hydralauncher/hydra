import { stateManager } from "./state-manager";
import { repackers } from "./constants";
import {
  getNewGOGGames,
  getNewRepacksFromCPG,
  getNewRepacksFromUser,
  getNewRepacksFromXatab,
  getNewRepacksFromOnlineFix,
  startProcessWatcher,
  DownloadManager,
  getNewRepacksFromByrut,
} from "./services";
import {
  gameRepository,
  repackRepository,
  repackerFriendlyNameRepository,
  steamGameRepository,
  userPreferencesRepository,
} from "./repository";
import { TorrentDownloader } from "./services";
import { Repack, UserPreferences } from "./entity";
import { Notification } from "electron";
import { t } from "i18next";
import { GameStatus } from "@shared";
import { In } from "typeorm";
import { RealDebridClient } from "./services/real-debrid";

startProcessWatcher();

const track1337xUsers = async (existingRepacks: Repack[]) => {
  for (const repacker of repackers) {
    await getNewRepacksFromUser(
      repacker,
      existingRepacks.filter((repack) => repack.repacker === repacker)
    );
  }
};

const checkForNewRepacks = async (userPreferences: UserPreferences | null) => {
  const existingRepacks = stateManager.getValue("repacks");

  Promise.allSettled([
    getNewRepacksFromByrut(
      existingRepacks.filter((repack) => repack.repacker === 'ByRutor')
    ),
    getNewGOGGames(
      existingRepacks.filter((repack) => repack.repacker === "GOG")
    ),
    getNewRepacksFromXatab(
      existingRepacks.filter((repack) => repack.repacker === "Xatab")
    ),
    getNewRepacksFromCPG(
      existingRepacks.filter((repack) => repack.repacker === "CPG")
    ),
    getNewRepacksFromOnlineFix(
      existingRepacks.filter((repack) => repack.repacker === "onlinefix")
    ),
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

const loadState = async (userPreferences: UserPreferences | null) => {
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

  if (userPreferences?.realDebridApiToken)
    await RealDebridClient.authorize(userPreferences?.realDebridApiToken);

  const game = await gameRepository.findOne({
    where: {
      status: In([
        GameStatus.Downloading,
        GameStatus.DownloadingMetadata,
        GameStatus.CheckingFiles,
      ]),
      isDeleted: false,
    },
    relations: { repack: true },
  });

  await TorrentDownloader.startClient();

  if (game) {
    DownloadManager.resumeDownload(game.id);
  }
};

userPreferencesRepository
  .findOne({
    where: { id: 1 },
  })
  .then((userPreferences) => {
    loadState(userPreferences).then(() => checkForNewRepacks(userPreferences));
  });
