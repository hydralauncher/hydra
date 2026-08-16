import { registerEvent } from "../register-event";
import axios from "axios";
import type { ShopAssets } from "@types";

interface FeaturedCache {
  data: ShopAssets[];
  timestamp: number;
}

const cacheMap = new Map<string, FeaturedCache>();
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes

const getSteamFeaturedEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  language: string
) => {
  try {
    const cached = cacheMap.get(language);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    const response = await axios.get(
      `https://store.steampowered.com/api/featuredcategories/?cc=BR&l=${language}`
    );
    const data = response.data;
    const games: ShopAssets[] = [];

    const addGames = (steamGames: any[]) => {
      if (!steamGames || !Array.isArray(steamGames)) return;
      for (const game of steamGames) {
        if (game.type !== 0 && game.type !== undefined) continue;

        const gameId = game.id || game.appid || game.item_id;
        if (!gameId) continue;

        const gameIdStr = gameId.toString();

        if (!games.find((g) => g.objectId === gameIdStr)) {
          games.push({
            objectId: gameIdStr,
            title: game.name || game.title,
            shop: "steam",
            coverImageUrl: game.large_capsule_image || game.header_image,
            libraryImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${gameIdStr}/library_600x900.jpg`,
            libraryHeroImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${gameIdStr}/library_hero.jpg`,
            logoImageUrl: `https://shared.steamstatic.com/store_item_assets/steam/apps/${gameIdStr}/logo.png`,
            // The library_600x900 asset above isn't guaranteed to exist for
            // every app (Steam only renders it once the store page has full
            // library assets), so give the UI a guaranteed-valid fallback
            // instead of null — otherwise cards with a missing library image
            // render blank.
            iconUrl: game.small_capsule_image || game.header_image || null,
            logoPosition: null,
            downloadSources: [],
          });
        }
      }
    };

    addGames(data.top_sellers?.items);
    addGames(data.specials?.items);

    cacheMap.set(language, { data: games, timestamp: Date.now() });
    return games;
  } catch (error) {
    return [];
  }
};

registerEvent("getSteamFeatured", getSteamFeaturedEvent);
