import { chunk } from "lodash-es";
import { AxiosError } from "axios";

import { HydraApi, emulators, WindowManager, logger } from "@main/services";
import { db, gamesSublevel } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import type { EmulatorSystem } from "@types";

import { runLaunchboxImport } from "./import-launchbox-roms";
import { setClassicsImporting } from "./classics-import-state";

const SYSTEMS: EmulatorSystem[] = ["ps1", "ps2", "ps3"];

const PLAYTIME_FETCH_CHUNK_SIZE = 10;

interface ProfileGameDetail {
  id?: string;
  playTimeInSeconds?: number;
  lastTimePlayed?: string | null;
  hasManuallyUpdatedPlaytime?: boolean;
}

const readClassicsGames = async () =>
  (await gamesSublevel.iterator().all()).filter(
    ([, game]) => game.shop === "launchbox" && !game.isDeleted
  );

type ClassicsGameEntries = Awaited<ReturnType<typeof readClassicsGames>>;

const syncClassicsPlaytime = async (launchboxGames: ClassicsGameEntries) => {
  if (!HydraApi.isLoggedIn() || launchboxGames.length === 0) return;

  const chunks = chunk(launchboxGames, PLAYTIME_FETCH_CHUNK_SIZE);

  for (const batch of chunks) {
    await Promise.all(
      batch.map(async ([key, game]) => {
        try {
          const profile = await HydraApi.get<ProfileGameDetail>(
            `/profile/games/launchbox/${encodeURIComponent(game.objectId)}`
          );

          const remotePlayTime = (profile.playTimeInSeconds ?? 0) * 1000;
          const remoteLastPlayed = profile.lastTimePlayed
            ? new Date(profile.lastTimePlayed)
            : null;

          const mergedLastPlayed =
            remoteLastPlayed &&
            (!game.lastTimePlayed ||
              remoteLastPlayed > new Date(game.lastTimePlayed))
              ? remoteLastPlayed
              : game.lastTimePlayed;

          await gamesSublevel.put(key, {
            ...game,
            remoteId: profile.id ?? game.remoteId,
            playTimeInMilliseconds: Math.max(
              game.playTimeInMilliseconds ?? 0,
              remotePlayTime
            ),
            lastTimePlayed: mergedLastPlayed,
            hasManuallyUpdatedPlaytime:
              profile.hasManuallyUpdatedPlaytime ??
              game.hasManuallyUpdatedPlaytime,
          });
        } catch (err) {
          if (err instanceof AxiosError && err.response?.status === 404) {
            return;
          }

          logger.error(
            `Failed to sync classics playtime for ${game.objectId}`,
            err
          );
        }
      })
    );
  }
};

export const reimportClassicsGames = async () => {
  const language =
    (await db
      .get<string, string>(levelKeys.language, { valueEncoding: "utf8" })
      .catch(() => "en")) ?? "en";

  const configs = await Promise.all(
    SYSTEMS.map(async (system) => ({
      system,
      config: await emulators.getEmulatorConfig(system),
    }))
  );

  const systemsToScan = configs.filter(
    ({ config }) => config.romFolders.length > 0
  );

  let classicsGames = await readClassicsGames();

  if (systemsToScan.length === 0 && classicsGames.length === 0) return;

  setClassicsImporting(true);
  WindowManager.sendToAppWindows("on-classics-import-status", true);

  try {
    for (const { system, config } of systemsToScan) {
      try {
        await runLaunchboxImport(
          system,
          config.romFolders.map((folder) => ({
            path: folder.path,
            scanSubfolders: folder.scanSubfolders,
          })),
          language,
          { cancelled: false }
        );
      } catch (err) {
        logger.error(`Failed to reimport classics games for ${system}`, err);
      }
    }

    if (systemsToScan.length > 0) classicsGames = await readClassicsGames();

    await syncClassicsPlaytime(classicsGames);

    WindowManager.sendToAppWindows("on-library-batch-complete");
  } finally {
    setClassicsImporting(false);
    WindowManager.sendToAppWindows("on-classics-import-status", false);
  }
};
