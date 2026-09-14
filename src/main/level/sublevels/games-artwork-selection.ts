import type { ArtworkAssetType, GameArtworkSelection } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const gamesArtworkSelectionSublevel = db.sublevel<
  string,
  GameArtworkSelection
>(levelKeys.artworkSelection, {
  valueEncoding: "json",
});

export const markArtworkSelectionSynced = async (
  gameKey: string,
  type: ArtworkAssetType,
  url: string
) => {
  const selection = await gamesArtworkSelectionSublevel.get(gameKey);
  const selected = selection?.selected[type];

  if (!selection || selected?.url !== url) return;

  await gamesArtworkSelectionSublevel.put(gameKey, {
    ...selection,
    selected: {
      ...selection.selected,
      [type]: { ...selected, syncedAt: Date.now() },
    },
  });
};
