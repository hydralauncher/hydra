import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

export const readUserPreferences = () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .catch(() => null);
