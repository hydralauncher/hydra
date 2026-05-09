import { db, gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { createGame } from "@main/services/library-sync";
import { HydraApi } from "@main/services/hydra-api";
import { SteamLibraryApi } from "@main/services/steam-library-api";
import { SteamSyncCancellation } from "@main/services/steam-sync-cancellation";
import { WindowManager } from "@main/services/window-manager";
import type { UserPreferences } from "@types";
import { registerEvent } from "../register-event";

const steamIconUrl = (appid: number, hash: string) =>
  `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${hash}.jpg`;

const syncSteamLibrary = async (_event: Electron.IpcMainInvokeEvent) => {
  SteamSyncCancellation.reset("library");

  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const { steamLinkedAccountId, steamApiKey } = userPreferences;

  if (!steamLinkedAccountId || !steamApiKey) {
    throw new Error("steam_not_configured");
  }

  const ownedGames = await SteamLibraryApi.getOwnedGames(
    steamLinkedAccountId,
    steamApiKey
  );

  const total = ownedGames.length;
  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let cancelled = false;

  for (let i = 0; i < ownedGames.length; i++) {
    if (SteamSyncCancellation.isRequested("library")) {
      cancelled = true;
      break;
    }
    const steamGame = ownedGames[i];
    const objectId = String(steamGame.appid);
    const gameKey = levelKeys.game("steam", objectId);

    WindowManager.mainWindow?.webContents.send(
      "on-steam-library-sync-progress",
      { current: i, total, gameTitle: steamGame.name }
    );

    const [existing, cachedAssets] = await Promise.all([
      gamesSublevel.get(gameKey),
      gamesShopAssetsSublevel.get(gameKey),
    ]);

    const steamPlaytimeMs = steamGame.playtime_forever * 60 * 1000;
    // Best icon: prefer Hydra shop cache, then Steam CDN, then null
    const iconUrl =
      cachedAssets?.iconUrl ??
      (steamGame.img_icon_url
        ? steamIconUrl(steamGame.appid, steamGame.img_icon_url)
        : null);

    if (existing && !existing.isDeleted) {
      // Game already in library — sync playtime if Steam has more
      const hydraPlaytimeMs = existing.playTimeInMilliseconds ?? 0;
      const deltaMs = steamPlaytimeMs - hydraPlaytimeMs;

      if (deltaMs > 0) {
        const updatedGame = {
          ...existing,
          playTimeInMilliseconds: steamPlaytimeMs,
          // Patch icon if it was missing
          iconUrl: existing.iconUrl ?? iconUrl,
          steamImported: true,
        };
        await gamesSublevel.put(gameKey, updatedGame);

        if (existing.remoteId) {
          await HydraApi.put(
            `/profile/games/${existing.shop}/${existing.objectId}/playtime`,
            { playTimeInSeconds: Math.trunc(steamPlaytimeMs / 1000) }
          ).catch(() => {});
        }
        updated++;
      } else {
        // Ensure icon and steamImported flag are up to date even if playtime is fine
        if (!existing.iconUrl || !existing.steamImported) {
          await gamesSublevel.put(gameKey, {
            ...existing,
            iconUrl: existing.iconUrl ?? iconUrl,
            steamImported: true,
          });
        }
        skipped++;
      }
      continue;
    }

    // New game — add to library
    const game = existing
      ? {
          ...existing,
          isDeleted: false,
          steamImported: true,
          playTimeInMilliseconds: steamPlaytimeMs,
          iconUrl: existing.iconUrl ?? iconUrl,
        }
      : {
          title: steamGame.name,
          iconUrl,
          libraryHeroImageUrl: null,
          logoImageUrl: null,
          objectId,
          shop: "steam" as const,
          remoteId: null,
          isDeleted: false,
          playTimeInMilliseconds: steamPlaytimeMs,
          lastTimePlayed: null,
          steamImported: true,
        };

    await gamesSublevel.put(gameKey, game);
    await createGame(game).catch(() => {});

    imported++;
  }

  SteamSyncCancellation.reset("library");

  WindowManager.mainWindow?.webContents.send(
    "on-steam-library-sync-progress",
    { current: cancelled ? (imported + updated + skipped) : total, total, gameTitle: "", done: true, cancelled }
  );

  WindowManager.mainWindow?.webContents.send("on-library-batch-complete");

  return { total, imported, updated, skipped, cancelled };
};

registerEvent("syncSteamLibrary", syncSteamLibrary);
