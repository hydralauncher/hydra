import { User, type ProfileVisibility, type UserDetails } from "@types";
import { HydraApi } from "../hydra-api";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";

export const getUserData = async () => {
  return HydraApi.get<UserDetails>(`/profile/me`)
    .then(async (me) => {
      db.get<string, User>(levelKeys.user, { valueEncoding: "json" }).then(
        (user) => {
          return db.put<string, User>(
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
        }
      );

      return me;
    })
    .catch(async (err) => {
      if (err instanceof UserNotLoggedInError) {
        return null;
      }
      logger.error("Failed to get logged user");

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

      return null;
    });
};
