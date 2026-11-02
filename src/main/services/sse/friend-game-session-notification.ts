import type { FriendGameSession } from "./types";

export interface FriendGameSessionNotification {
  displayName: string;
  profileImageUrl: string | null;
  gameTitle: string | null;
}

const nonBlankString = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

export const toFriendGameSessionNotification = (
  payload: FriendGameSession
): FriendGameSessionNotification | null => {
  const displayName = nonBlankString(payload.displayName);
  if (!displayName) return null;

  return {
    displayName,
    profileImageUrl: nonBlankString(payload.profileImageUrl),
    gameTitle: nonBlankString(payload.gameTitle),
  };
};
