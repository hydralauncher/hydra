import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { mergeAchievements } from "./achievements/merge-achievements";
import { createGame } from "./library-sync";
import { HydraApi } from "./hydra-api";
import { SteamAchievementsApi } from "./steam-achievements-api";
import { SteamLibraryApi } from "./steam-library-api";
import { SteamSyncCancellation } from "./steam-sync-cancellation";
import { WindowManager } from "./window-manager";
import type { UserPreferences } from "@types";

const buildIconUrl = (appid: number, hash: string) =>
  `https://media.steampowered.com/steamcommunity/public/images/apps/${appid}/${hash}.jpg`;

export const runSteamStartupSync = async (
  userPreferences: UserPreferences
) => {
  const { steamLinkedAccountId, steamApiKey } = userPreferences;
  if (!steamLinkedAccountId || !steamApiKey) return;

  // ── Library sync ────────────────────────────────────────────────────────────
  SteamSyncCancellation.reset("library");

  const ownedGames = await SteamLibraryApi.getOwnedGames(
    steamLinkedAccountId,
    steamApiKey
  ).catch(() => []);

  for (const sg of ownedGames) {
    if (SteamSyncCancellation.isRequested("library")) break;

    const objectId = String(sg.appid);
    const gameKey = levelKeys.game("steam", objectId);
    const [existing, cachedAssets] = await Promise.all([
      gamesSublevel.get(gameKey),
      gamesShopAssetsSublevel.get(gameKey),
    ]);

    const steamPlaytimeMs = sg.playtime_forever * 60 * 1000;
    const iconUrl =
      cachedAssets?.iconUrl ??
      (sg.img_icon_url ? buildIconUrl(sg.appid, sg.img_icon_url) : null);

    if (existing && !existing.isDeleted) {
      const deltaMs = steamPlaytimeMs - (existing.playTimeInMilliseconds ?? 0);
      if (deltaMs > 0) {
        await gamesSublevel.put(gameKey, {
          ...existing,
          playTimeInMilliseconds: steamPlaytimeMs,
          iconUrl: existing.iconUrl ?? iconUrl,
          steamImported: true,
        });
        if (existing.remoteId) {
          await HydraApi.put(
            `/profile/games/${existing.shop}/${existing.objectId}/playtime`,
            { playTimeInSeconds: Math.trunc(steamPlaytimeMs / 1000) }
          ).catch(() => {});
        }
      }
      continue;
    }

    const game = existing
      ? {
          ...existing,
          isDeleted: false,
          steamImported: true,
          playTimeInMilliseconds: steamPlaytimeMs,
          iconUrl: existing.iconUrl ?? iconUrl,
        }
      : {
          title: sg.name,
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
  }

  SteamSyncCancellation.reset("library");

  // ── Achievement sync ─────────────────────────────────────────────────────────
  SteamSyncCancellation.reset("achievements");

  const allGames = await gamesSublevel.values().all();
  const steamGames = allGames.filter(
    (g) => g.shop === "steam" && !g.isDeleted
  );

  for (const game of steamGames) {
    if (SteamSyncCancellation.isRequested("achievements")) break;
    try {
      const unlocked = await SteamAchievementsApi.getPlayerAchievements(
        steamLinkedAccountId,
        steamApiKey,
        game.objectId
      );
      await mergeAchievements(game, unlocked, false);
    } catch {
      // Skip games with no achievements
    }
  }

  SteamSyncCancellation.reset("achievements");

  WindowManager.mainWindow?.webContents.send("on-library-batch-complete");
};
