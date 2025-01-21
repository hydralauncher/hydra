import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

const getUserPreferences = async () =>
  db.get<string, UserPreferences>(levelKeys.userPreferences, {
    valueEncoding: "json",
  });

registerEvent("getUserPreferences", getUserPreferences);
