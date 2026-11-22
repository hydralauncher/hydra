import { gamesSublevel, levelKeys, playLaterSublevel } from "@main/level";
import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";
import { withoutLibraryGames } from "@shared";
import { registerEvent } from "../register-event";

const getPlayLater = async (_event: Electron.IpcMainInvokeEvent) => {
  // Local read only: the library as this account sees it, like getLibrary.
  const authContext = HydraApi.getAuthContext();
  const [entries, games] = await Promise.all([
    playLaterSublevel.values().all(),
    gamesSublevel.values().all(),
  ]);

  const kept = withoutLibraryGames(
    entries,
    games.map((game) => getContextualEpicGame(game, authContext))
  );

  // A game that entered the library, however it got there, leaves the list.
  if (kept.length < entries.length) {
    const keptEntries = new Set(kept);
    try {
      await playLaterSublevel.batch(
        entries
          .filter((entry) => !keptEntries.has(entry))
          .map((entry) => ({
            type: "del" as const,
            key: levelKeys.game(entry.shop, entry.objectId),
          }))
      );
    } catch (error) {
      // The next read tries again; the list itself is still right.
      logger.error("Failed to prune Play later", error);
    }
  }

  return kept;
};

registerEvent("getPlayLater", getPlayLater);
