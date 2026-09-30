import { chunk } from "lodash-es";
import {
  db,
  downloadsSublevel,
  gamesArtworkSelectionSublevel,
  gamesSublevel,
} from "@main/level";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import { steamSyncLogger } from "../logger";
import { shouldRemoveImportedSteamGame } from "./steam-imported-games";

const CLEAR_WRITE_CHUNK_SIZE = 250;

export const clearImportedSteamGames = async (steamOnlyObjectIds: string[]) => {
  const ids = new Set(steamOnlyObjectIds);
  const candidates = (await gamesSublevel.iterator().all()).filter(([, game]) =>
    shouldRemoveImportedSteamGame(game, ids)
  );
  let removed = 0;

  for (const candidatesChunk of chunk(candidates, CLEAR_WRITE_CHUNK_SIZE)) {
    const downloads = await downloadsSublevel.getMany(
      candidatesChunk.map(([key]) => key)
    );
    const batch = db.batch();

    candidatesChunk.forEach(([key, game], index) => {
      if (downloads[index]) return;

      batch.put(
        key,
        {
          ...updateGameExecutablePath(game, null),
          isDeleted: true,
          customIconUrl: null,
          customLogoImageUrl: null,
          customHeroImageUrl: null,
          customCoverImageUrl: null,
        },
        { sublevel: gamesSublevel }
      );
      batch.del(key, { sublevel: gamesArtworkSelectionSublevel });
      removed += 1;
    });

    await batch.write();
  }

  steamSyncLogger.log(
    "Cleared imported Steam games",
    removed,
    "of",
    ids.size,
    "remote steam-only ids"
  );

  return removed;
};
