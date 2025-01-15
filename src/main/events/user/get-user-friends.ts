import { db } from "@main/level";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import type { User, UserFriends } from "@types";
import { levelKeys } from "@main/level/sublevels/keys";

export const getUserFriends = async (
  userId: string,
  take: number,
  skip: number
): Promise<UserFriends> => {
  const user = await db.get<string, User>(levelKeys.user, {
    valueEncoding: "json",
  });

  if (user?.id === userId) {
    return HydraApi.get(`/profile/friends`, { take, skip });
  }

  return HydraApi.get(`/users/${userId}/friends`, { take, skip });
};

const getUserFriendsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  userId: string,
  take: number,
  skip: number
) => {
  return getUserFriends(userId, take, skip);
};

registerEvent("getUserFriends", getUserFriendsEvent);
