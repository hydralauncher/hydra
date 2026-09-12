import type { GameInstallation } from "@types";
import { db } from "../level";
import { levelKeys } from "./keys";

export const gameInstallationsSublevel = db.sublevel<string, GameInstallation>(
  levelKeys.installations,
  { valueEncoding: "json" }
);
