import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import type { ProfileVisibility, UserDetails } from "@types";
import { userAuthRepository } from "@main/repository";
import { UserNotLoggedInError } from "@shared";
import { getUserData } from "@main/services/user/get-user-data";

const getMe = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<UserDetails | null> => {
  return getUserData().catch(async (err) => {
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
