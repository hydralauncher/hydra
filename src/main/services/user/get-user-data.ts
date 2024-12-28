import type { ProfileVisibility, UserDetails } from "@types";
import { HydraApi } from "../hydra-api";
import {
  userAuthRepository,
  userSubscriptionRepository,
} from "@main/repository";
import { UserNotLoggedInError } from "@shared";
import { logger } from "../logger";

export const getUserData = () => {
  return HydraApi.get<UserDetails>(`/profile/me`)
    .then(async (me) => {
      userAuthRepository.upsert(
        {
          id: 1,
          displayName: me.displayName,
          profileImageUrl: me.profileImageUrl,
          backgroundImageUrl: me.backgroundImageUrl,
          userId: me.id,
        },
        ["id"]
      );

      if (me.subscription) {
        await userSubscriptionRepository.upsert(
          {
            id: 1,
            subscriptionId: me.subscription?.id || "",
            status: me.subscription?.status || "",
            planId: me.subscription?.plan.id || "",
            planName: me.subscription?.plan.name || "",
            expiresAt: me.subscription?.expiresAt || null,
            user: { id: 1 },
          },
          ["id"]
        );
      } else {
        await userSubscriptionRepository.delete({ id: 1 });
      }

      return me;
    })
    .catch(async (err) => {
      if (err instanceof UserNotLoggedInError) {
        logger.info("User is not logged in", err);
        return null;
      }
      logger.error("Failed to get logged user");
      const loggedUser = await userAuthRepository.findOne({
        where: { id: 1 },
        relations: { subscription: true },
      });

      if (loggedUser) {
        return {
          ...loggedUser,
          id: loggedUser.userId,
          username: "",
          bio: "",
          email: null,
          profileVisibility: "PUBLIC" as ProfileVisibility,
          quirks: {
            backupsPerGameLimit: 0,
          },
          subscription: loggedUser.subscription
            ? {
                id: loggedUser.subscription.subscriptionId,
                status: loggedUser.subscription.status,
                plan: {
                  id: loggedUser.subscription.planId,
                  name: loggedUser.subscription.planName,
                },
                expiresAt: loggedUser.subscription.expiresAt,
              }
            : null,
        } as UserDetails;
      }

      return null;
    });
};
