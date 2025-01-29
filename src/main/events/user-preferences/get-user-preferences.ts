import { registerEvent } from "../register-event";
import { db, levelKeys } from "@main/level";
import { Crypto } from "@main/services";
import type { UserPreferences } from "@types";

const getUserPreferences = async () =>
  db
    .get<string, UserPreferences | null>(levelKeys.userPreferences, {
      valueEncoding: "json",
    })
    .then((userPreferences) => {
      if (userPreferences?.realDebridApiToken) {
        userPreferences.realDebridApiToken = Crypto.decrypt(
          userPreferences.realDebridApiToken
        );
      }

      return userPreferences;
    });

registerEvent("getUserPreferences", getUserPreferences);
