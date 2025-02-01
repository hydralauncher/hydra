import type { Theme } from "@types";
import { db } from "../level";
import { levelKeys } from "./keys";

export const themes = db.sublevel<string, Theme>(levelKeys.themes, {
  valueEncoding: "json",
});
