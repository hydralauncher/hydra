import { registerEvent } from "../register-event";
import { gamesSublevel, gamesShopCacheSublevel, levelKeys } from "@main/level";
import { getSteamLanguage, logger } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import axios from "axios";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const refreshLibraryReleaseDates = async (_event: any, language: string) => {
  try {
    const steamLanguage = getSteamLanguage(language);
    const libraryGames = await gamesSublevel.iterator().all();
    const shopCache = await gamesShopCacheSublevel.iterator().all();
    
    // Quick cache lookup map
    const cacheMap = new Set<string>();
    for (const [key] of shopCache) {
      if (typeof key === "string" && key.includes(`:${steamLanguage}`)) {
        const parts = key.split(":");
        if (parts.length >= 2) {
          cacheMap.add(`${parts[0]}:${parts[1]}`);
        }
      }
    }

    const missingSteamGames = libraryGames
      .filter(([_key, game]) => !game.isDeleted && game.shop === "steam")
      .filter(([key]) => !cacheMap.has(key));

    if (missingSteamGames.length === 0) return;

    logger.info(`Fetching release dates for ${missingSteamGames.length} missing games...`);

    // Fetch in background in chunks of 50
    (async () => {
      let updatedCount = 0;
      const chunkSize = 50;
      
      const missingArray = Array.from(missingSteamGames);
      for (let i = 0; i < missingArray.length; i += chunkSize) {
        const chunk = missingArray.slice(i, i + chunkSize);
        const appids = chunk.map(([_, game]) => game.objectId).join(",");
        
        try {
          const searchParams = new URLSearchParams({
            appids,
            l: steamLanguage,
            cc: "us",
          });
          
          const response = await axios.get(
            `http://store.steampowered.com/api/appdetails?${searchParams.toString()}`
          );
          
          for (const [_key, game] of chunk) {
            const result = response.data[game.objectId];
            if (result && result.success && result.data) {
              const details = result.data;
              details.name = game.title;
              details.objectId = game.objectId;
              await gamesShopCacheSublevel.put(
                levelKeys.gameShopCacheItem("steam", game.objectId, steamLanguage),
                details
              );
              updatedCount++;
            }
          }
          
          WindowManager.mainWindow?.webContents.send("on-library-batch-complete");
        } catch (err) {
          logger.error(`Failed to fetch release dates chunk for ${appids}`, err);
        }
        
        await delay(500); // Prevent rate limiting between chunks
      }
      
      logger.info(`Finished fetching release dates. Updated ${updatedCount} games.`);
    })();
    
  } catch (err) {
    logger.error("Error in refreshLibraryReleaseDates", err);
  }
};

registerEvent("refreshLibraryReleaseDates", refreshLibraryReleaseDates);
