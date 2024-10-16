import { registerEvent } from "../register-event";
import * as Sentry from "@sentry/electron/main";
import { HydraApi, logger } from "@main/services";
import { ProfileVisibility, UserDetails } from "@types";
import {
  userAuthRepository,
  userSubscriptionRepository,
} from "@main/repository";
import { UserNotLoggedInError } from "@shared";

const getMe = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<UserDetails | null> => {
  return HydraApi.get<UserDetails>(`/profile/me`)
    .then((me) => {
      userAuthRepository.upsert(
        {
          id: 1,
          displayName: me.displayName,
          profileImageUrl: me.profileImageUrl,
          userId: me.id,
        },
        ["id"]
      );

      if (me.subscription) {
        userSubscriptionRepository.upsert(
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
        userSubscriptionRepository.delete({ id: 1 });
      }

      Sentry.setUser({ id: me.id, username: me.username });

      return me;
    })
    .catch(async (err) => {
      if (err instanceof UserNotLoggedInError) {
        return null;
      }
      logger.error("Failed to get logged user", err);
      const loggedUser = await userAuthRepository.findOne({ where: { id: 1 } });

      if (loggedUser) {
        return {
          ...loggedUser,
          id: loggedUser.userId,
          username: "",
          bio: "",
          profileVisibility: "PUBLIC" as ProfileVisibility,
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
        };
      }

      return null;
    });
};

registerEvent("getMe", getMe);
