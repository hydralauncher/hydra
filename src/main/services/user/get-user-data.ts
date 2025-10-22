import {
  User,
  type ProfileVisibility,
  type UserDetails,
  type UserPreferences,
} from "@types";
import { HydraApi } from "../hydra-api";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";

export const getUserData = async () => {
  let language = "en";
  try {
    const userPreferences = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    if (userPreferences?.language) {
      const supportedLanguages = ["pt", "ru", "es"];
      const userLang = userPreferences.language.split("-")[0];
      language = supportedLanguages.includes(userLang) ? userLang : "en";
    }
  } catch (error) {
    logger.error("Failed to get user preferences for language", error);
  }

  const params = new URLSearchParams({ language });
  return HydraApi.get<UserDetails>(`/profile/me?${params.toString()}`)
    .then(async (me) => {
      try {
        const user = await db.get<string, User>(levelKeys.user, {
          valueEncoding: "json",
        });
        await db.put<string, User>(
          levelKeys.user,
          {
            ...user,
            id: me.id,
            displayName: me.displayName,
            profileImageUrl: me.profileImageUrl,
            backgroundImageUrl: me.backgroundImageUrl,
            subscription: me.subscription,
          },
          { valueEncoding: "json" }
        );
      } catch (error) {
        logger.error("Failed to update user in DB", error);
      }
      return me;
    })
    .catch(async (err) => {
      if (err instanceof UserNotLoggedInError) {
        return null;
      }

      logger.error("Failed to get logged user", err);

      try {
        const loggedUser = await db.get<string, User>(levelKeys.user, {
          valueEncoding: "json",
        });

        if (loggedUser) {
          return {
            ...loggedUser,
            username: "",
            bio: "",
            email: null,
            profileVisibility: "PUBLIC" as ProfileVisibility,
            quirks: {
              backupsPerGameLimit: 0,
            },
            subscription: loggedUser.subscription
              ? {
                  id: loggedUser.subscription.id,
                  status: loggedUser.subscription.status,
                  plan: {
                    id: loggedUser.subscription.plan.id,
                    name: loggedUser.subscription.plan.name,
                  },
                  expiresAt: loggedUser.subscription.expiresAt,
                }
              : null,
            featurebaseJwt: "",
          } as UserDetails;
        }
      } catch (dbError) {
        logger.error("Failed to read user from DB", dbError);
      }

      return null;
    });
};
