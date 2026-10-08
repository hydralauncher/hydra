import type { User, UserDetails } from "@types";
import { HydraApi } from "../hydra-api";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";

export const getUserData = async (): Promise<UserDetails | null> => {
  const context = HydraApi.getAuthContext();
  if (!context || !HydraApi.isAuthContextCurrent(context)) return null;

  let me: UserDetails;
  try {
    me = await HydraApi.get<UserDetails>("/profile/me", undefined, {
      authContext: context,
    });
  } catch (error) {
    if (
      !HydraApi.isAuthContextCurrent(context) ||
      error instanceof UserNotLoggedInError
    ) {
      return null;
    }
    logger.error("Failed to get logged user");
    try {
      const user = await db.get<string, User>(levelKeys.user, {
        valueEncoding: "json",
      });
      if (
        !HydraApi.isAuthContextCurrent(context) ||
        user?.id !== context.userId
      )
        return null;
      return {
        ...user,
        username: "",
        bio: "",
        email: null,
        profileVisibility: "PUBLIC",
        souvenirsVisibility: "PRIVATE",
        quirks: { backupsPerGameLimit: 0 },
        subscription: user.subscription
          ? {
              id: user.subscription.id,
              status: user.subscription.status,
              plan: {
                id: user.subscription.plan.id,
                name: user.subscription.plan.name,
              },
              expiresAt: user.subscription.expiresAt,
            }
          : null,
      } as UserDetails;
    } catch {
      if (HydraApi.isAuthContextCurrent(context))
        logger.error("Failed to read user from DB");
      return null;
    }
  }

  if (!HydraApi.isAuthContextCurrent(context) || me.id !== context.userId)
    return null;
  try {
    const cached = await db.get<string, User>(levelKeys.user, {
      valueEncoding: "json",
    });
    if (!HydraApi.isAuthContextCurrent(context)) return null;
    await HydraApi.persistUserCache(
      {
        ...cached,
        id: me.id,
        displayName: me.displayName,
        profileImageUrl: me.profileImageUrl,
        backgroundImageUrl: me.backgroundImageUrl,
        subscription: me.subscription,
      },
      context
    );
  } catch {
    if (!HydraApi.isAuthContextCurrent(context)) return null;
    logger.error("Failed to update user in DB");
  }

  if (!HydraApi.isAuthContextCurrent(context)) return null;
  HydraApi.updateUserSubscription(me.subscription);
  return me;
};
