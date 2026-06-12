import type { UserDetails } from "@types";
import { create } from "zustand";

const USER_DETAILS_STORAGE_KEY = "userDetails";

function getCachedUserDetails() {
  try {
    const cachedUserDetails = globalThis.window.localStorage.getItem(
      USER_DETAILS_STORAGE_KEY
    );

    if (!cachedUserDetails) return null;

    return JSON.parse(cachedUserDetails) as UserDetails;
  } catch {
    return null;
  }
}

function persistUserDetails(userDetails: UserDetails | null) {
  if (!userDetails) {
    globalThis.window.localStorage.removeItem(USER_DETAILS_STORAGE_KEY);
    return;
  }

  globalThis.window.localStorage.setItem(
    USER_DETAILS_STORAGE_KEY,
    JSON.stringify(userDetails)
  );
}

interface BigPictureUserDetailsState {
  userDetails: UserDetails | null;
  setUserDetails: (userDetails: UserDetails | null) => void;
  clearUserDetails: () => void;
  loadCachedUserDetails: () => UserDetails | null;
}

export const useBigPictureUserDetailsStore = create<BigPictureUserDetailsState>(
  (set) => ({
    userDetails: getCachedUserDetails(),
    setUserDetails: (userDetails) => {
      persistUserDetails(userDetails);
      set({ userDetails });
    },
    clearUserDetails: () => {
      persistUserDetails(null);
      set({ userDetails: null });
    },
    loadCachedUserDetails: () => {
      const userDetails = getCachedUserDetails();
      set({ userDetails });
      return userDetails;
    },
  })
);
