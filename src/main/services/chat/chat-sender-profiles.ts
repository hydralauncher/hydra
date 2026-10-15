import type { UserFriend, UserProfile } from "@types";
import { HydraApi } from "../hydra-api";

const SENDER_PROFILE_TTL_MS = 5 * 60 * 1000;

const profiles = new Map<string, { profile: UserFriend; fetchedAt: number }>();

// Notifications need the sender's name and avatar, and clicking one opens the
// chat window, which needs a full UserFriend.
export const getChatSenderProfile = async (
  friendId: string,
  signal?: AbortSignal
): Promise<UserFriend> => {
  const cached = profiles.get(friendId);
  if (cached && Date.now() - cached.fetchedAt < SENDER_PROFILE_TTL_MS) {
    return cached.profile;
  }

  const user = await HydraApi.get<UserProfile>(
    `/users/${friendId}`,
    undefined,
    {
      signal,
    }
  );
  const profile: UserFriend = {
    id: friendId,
    displayName: user.displayName,
    profileImageUrl: user.profileImageUrl,
    backgroundImageUrl: user.backgroundImageUrl,
    currentGame: null,
  };
  profiles.set(friendId, { profile, fetchedAt: Date.now() });

  return profile;
};

export const clearChatSenderProfiles = () => profiles.clear();
