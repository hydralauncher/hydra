import { userAuthRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";
import { UserFriends } from "@types";

export const getUserFriends = async (
  userId: string,
  take: number,
  skip: number
): Promise<UserFriends> => {
  const loggedUser = await userAuthRepository.findOne({ where: { id: 1 } });

  if (loggedUser?.userId == userId) {
    return HydraApi.get(`/profile/friends`, { take, skip }).catch(
      (_err) => {
        return { totalFriends: 0, friends: [] };
      }
    );
  }

  return HydraApi.get(`/user/${userId}/friends`, { take, skip }).catch(
    (_err) => {
      return { totalFriends: 0, friends: [] };
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
