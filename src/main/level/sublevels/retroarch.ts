import { db } from "../level";
import { levelKeys } from "./keys";
import type { RetroArchConfig } from "@types";

export const retroarchSublevel = db.sublevel<string, RetroArchConfig>(
  levelKeys.retroarch,
  {
    valueEncoding: "json",
  }
);
