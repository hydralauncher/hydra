import { User, type UserDetails } from "@types";
import { HydraApi } from "../hydra-api";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";
import { getUserDataForContext } from "./get-user-data-core";

export const getUserData = async () => {
  const context = HydraApi.getAuthContext();
  return getUserDataForContext({
    context,
    isCurrent: (context) => HydraApi.isAuthContextCurrent(context),
    getProfile: (context) =>
      HydraApi.get<UserDetails>("/profile/me", undefined, {
        authContext: context,
      }),
    getCachedUser: () =>
      db.get<string, User>(levelKeys.user, { valueEncoding: "json" }),
    putCachedUser: (user) =>
      context
        ? HydraApi.persistUserCache(user, context)
        : Promise.reject(new UserNotLoggedInError()),
    updateSubscription: (subscription) =>
      HydraApi.updateUserSubscription(subscription),
    isAuthRequiredError: (error) => error instanceof UserNotLoggedInError,
    reportError: (operation) => {
      const messages = {
        profile: "Failed to get logged user",
        "cache-read": "Failed to read user from DB",
        "cache-write": "Failed to update user in DB",
      };
      logger.error(messages[operation]);
    },
  });
};
