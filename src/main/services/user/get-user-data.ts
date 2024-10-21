import type { UserDetails } from "@types";
import { HydraApi } from "../hydra-api";
import {
  userAuthRepository,
  userSubscriptionRepository,
} from "@main/repository";
import * as Sentry from "@sentry/electron/main";

export const getUserData = () => {
  return HydraApi.get<UserDetails>(`/profile/me`).then(async (me) => {
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

    Sentry.setUser({ id: me.id, username: me.username });

    return me;
  });
};
