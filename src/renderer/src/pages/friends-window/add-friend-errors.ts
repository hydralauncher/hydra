export const FRIEND_CODE_LENGTH = 8;

export type AddFriendErrorKey =
  | "already_friends"
  | "friend_request_pending"
  | "friend_code_not_found";

const ERROR_KEYS_BY_CODE: Record<string, AddFriendErrorKey> = {
  "friendship/users-already-friends": "already_friends",
  "friendship/has-pending-invitation": "friend_request_pending",
  "friendship/not-found": "friend_code_not_found",
  "user/not-found": "friend_code_not_found",
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
};

export const getAddFriendErrorKey = (
  error: unknown
): AddFriendErrorKey | null => {
  const message = getErrorMessage(error);

  for (const [code, key] of Object.entries(ERROR_KEYS_BY_CODE)) {
    if (message.includes(code)) return key;
  }

  return null;
};

export const isUserNotFoundError = (error: unknown) => {
  const message = getErrorMessage(error);
  return message.includes("user/not-found") || /\b404\b/.test(message);
};

export const normalizeFriendCode = (value: string) =>
  value.trim().slice(0, FRIEND_CODE_LENGTH);
