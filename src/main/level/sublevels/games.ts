import { Game } from "@types";
import { db } from "../level";
import { levelKeys } from "./keys";

export const gamesSublevel = db.sublevel<string, Game>(levelKeys.games, {
  valueEncoding: "json",
});
