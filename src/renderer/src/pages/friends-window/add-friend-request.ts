const STORAGE_KEY = "friends-window-add-friend-request";
// An older request is one whose window never opened, so it must not fire later.
const REQUEST_MAX_AGE_MS = 10_000;

// The friends window is a separate window that may already be open, so the
// request goes through localStorage: it is shared between windows, and the
// `storage` event reaches a window that is already open.
export const requestAddFriendMode = () => {
  localStorage.setItem(STORAGE_KEY, String(Date.now()));
};

export const consumeAddFriendRequest = () => {
  const requestedAt = Number(localStorage.getItem(STORAGE_KEY));
  if (!requestedAt) return false;

  localStorage.removeItem(STORAGE_KEY);
  return Date.now() - requestedAt < REQUEST_MAX_AGE_MS;
};
