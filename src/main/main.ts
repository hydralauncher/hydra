import { DownloadManager, logger, Ludusavi, startMainLoop } from "./services";
import { RealDebridClient } from "./services/download/real-debrid";
import { HydraApi } from "./services/hydra-api";
import { uploadGamesBatch } from "./services/library-sync";
import { Aria2 } from "./services/aria2";
import { downloadsSublevel } from "./level/sublevels/downloads";
import { sortBy } from "lodash-es";
import { Downloader } from "@shared";
import { gameAchievementsSublevel, gamesSublevel, levelKeys } from "./level";
import { Auth, User, type UserPreferences } from "@types";
import { db } from "./level";
import { knexClient } from "./knex-client";

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

const migrateFromSqlite = async () => {
  const sqliteMigrationDone = await db.get(levelKeys.sqliteMigrationDone);

  if (sqliteMigrationDone) {
    return;
  }

  const migrateGames = knexClient("game")
    .select("*")
    .then((games) => {
      return gamesSublevel.batch(
        games.map((game) => ({
          type: "put",
          key: levelKeys.game(game.shop, game.objectID),
          value: {
            objectId: game.objectID,
            shop: game.shop,
            title: game.title,
            iconUrl: game.iconUrl,
            playTimeInMilliseconds: game.playTimeInMilliseconds,
            lastTimePlayed: game.lastTimePlayed,
            remoteId: game.remoteId,
            isDeleted: game.isDeleted,
          },
        }))
      );
    })
    .then(() => {
      logger.info("Games migrated successfully");
    });

  const migrateUserPreferences = knexClient("user_preferences")
    .select("*")
    .then(async (userPreferences) => {
      if (userPreferences.length > 0) {
        await db.put(levelKeys.userPreferences, userPreferences[0]);

        if (userPreferences[0].language) {
          await db.put(levelKeys.language, userPreferences[0].language);
        }
      }
    })
    .then(() => {
      logger.info("User preferences migrated successfully");
    });

  const migrateAchievements = knexClient("game_achievement")
    .select("*")
    .then((achievements) => {
      return gameAchievementsSublevel.batch(
        achievements.map((achievement) => ({
          type: "put",
          key: levelKeys.game(achievement.shop, achievement.objectId),
          value: {
            achievements: JSON.parse(achievement.achievements),
            unlockedAchievements: JSON.parse(achievement.unlockedAchievements),
          },
        }))
      );
    })
    .then(() => {
      logger.info("Achievements migrated successfully");
    });

  const migrateUser = knexClient("user_auth")
    .select("*")
    .then(async (users) => {
      if (users.length > 0) {
        await db.put<string, User>(
          levelKeys.user,
          {
            id: users[0].userId,
            displayName: users[0].displayName,
            profileImageUrl: users[0].profileImageUrl,
            backgroundImageUrl: users[0].backgroundImageUrl,
            subscription: users[0].subscription,
          },
          {
            valueEncoding: "json",
          }
        );

        await db.put<string, Auth>(
          levelKeys.auth,
          {
            accessToken: users[0].accessToken,
            refreshToken: users[0].refreshToken,
            tokenExpirationTimestamp: users[0].tokenExpirationTimestamp,
          },
          {
            valueEncoding: "json",
          }
        );
      }
    })
    .then(() => {
      logger.info("User data migrated successfully");
    });

  return Promise.all([
    migrateGames,
    migrateUserPreferences,
    migrateAchievements,
    migrateUser,
  ]);
};

migrateFromSqlite().then(async () => {
  await db.put<string, boolean>(levelKeys.sqliteMigrationDone, true, {
    valueEncoding: "json",
  });

  db.get<string, UserPreferences>(levelKeys.userPreferences, {
    valueEncoding: "json",
  }).then((userPreferences) => {
    loadState(userPreferences);
  });
});
