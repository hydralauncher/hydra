import { gamesSublevel, levelKeys, playLaterSublevel } from "@main/level";
import { withoutLibraryGames } from "@shared";
import { registerEvent } from "../register-event";

const getPlayLater = async (_event: Electron.IpcMainInvokeEvent) => {
  const [entries, games] = await Promise.all([
    playLaterSublevel.values().all(),
    gamesSublevel.values().all(),
  ]);

  const kept = withoutLibraryGames(entries, games);

  // A game that entered the library, however it got there, leaves the list.
  if (kept.length < entries.length) {
    const keptEntries = new Set(kept);
    await playLaterSublevel.batch(
      entries
        .filter((entry) => !keptEntries.has(entry))
        .map((entry) => ({
          type: "del" as const,
          key: levelKeys.game(entry.shop, entry.objectId),
        }))
    );
  }

  return kept;
};

registerEvent("getPlayLater", getPlayLater);
