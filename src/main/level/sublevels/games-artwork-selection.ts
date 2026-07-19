import type { GameArtworkSelection } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const gamesArtworkSelectionSublevel = db.sublevel<
  string,
  GameArtworkSelection
>(levelKeys.artworkSelection, {
  valueEncoding: "json",
});
