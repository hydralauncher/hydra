import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { UserFriends } from "@types";

export const getUserFriends = async (
  userId: string,
  take: number,
  skip: number
): Promise<UserFriends> => {
  return HydraApi.get(`/user/${userId}/friends`, { take, skip }).catch(
    (_err) => {
      return { totalFriends: 0, friends: [] } as UserFriends;
    }
  );
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
