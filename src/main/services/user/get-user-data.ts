import { User, type ProfileVisibility, type UserDetails } from "@types";
import { HydraApi } from "../hydra-api";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";
import { db } from "@main/level";
import { levelKeys } from "@main/level/sublevels";

/* With a self-hosted cloud server configured, the subscription-gated
   features are provided by that server, so a synthetic always-active
   subscription is injected for accounts without a real one. Everything else
   in the user data comes from the official API untouched. */
const applySelfHostedCloudPerks = (me: UserDetails): UserDetails => {
  if (!HydraApi.isSelfHostedCloudEnabled()) return me;

  const hasRealSubscription =
    me.subscription?.expiresAt &&
    new Date(me.subscription.expiresAt) > new Date();

  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 100);

  return {
    ...me,
    subscription: hasRealSubscription
      ? me.subscription
      : {
          id: "self-hosted",
          status: "active",
          plan: { id: "self-hosted", name: "Self-hosted" },
          expiresAt: expiresAt.toISOString(),
          paymentMethod: "pix",
        },
    quirks: {
      ...me.quirks,
      backupsPerGameLimit: Math.max(me.quirks?.backupsPerGameLimit ?? 0, 100),
    },
  };
};

export const getUserData = async () => {
  return HydraApi.get<UserDetails>(`/profile/me`)
    .then(async (remoteMe) => {
      /* Record the REAL subscription before injecting the synthetic one so
         routing can distinguish actual Hydra Cloud subscribers. */
      HydraApi.syncRealSubscription(remoteMe.subscription);

      const me = applySelfHostedCloudPerks(remoteMe);

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
          } as UserDetails;
        }
      } catch (dbError) {
        logger.error("Failed to read user from DB", dbError);
      }

      return null;
    });
};
