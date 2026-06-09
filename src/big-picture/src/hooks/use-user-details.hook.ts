import { useCallback, useEffect, useMemo, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type { UpdateProfileRequest, UserDetails, UserProfile } from "@types";

const USER_DETAILS_STORAGE_KEY = "userDetails";

function getInitialUserDetails() {
  try {
    const cachedUserDetails = globalThis.window.localStorage.getItem(
      USER_DETAILS_STORAGE_KEY
    );

    if (!cachedUserDetails) {
      return null;
    }

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

function mergeUserProfileIntoDetails(
  currentUserDetails: UserDetails | null,
  updatedProfile: UserProfile
): UserDetails {
  return {
    id: updatedProfile.id,
    username: currentUserDetails?.username ?? "",
    email: updatedProfile.email,
    displayName: updatedProfile.displayName,
    profileImageUrl: updatedProfile.profileImageUrl,
    backgroundImageUrl: updatedProfile.backgroundImageUrl,
    profileVisibility: updatedProfile.profileVisibility,
    bio: updatedProfile.bio,
    workwondersJwt: currentUserDetails?.workwondersJwt ?? "",
    subscription: currentUserDetails?.subscription ?? null,
    karma: currentUserDetails?.karma ?? 0,
    quirks: updatedProfile.quirks,
  };
}

export function useUserDetails() {
  const [userDetails, setUserDetails] = useState<UserDetails | null>(
    getInitialUserDetails
  );

  const fetchUserDetails = useCallback(async () => {
    if (!IS_DESKTOP) return;

    try {
      const details = await window.electron.getMe();
      persistUserDetails(details);
      setUserDetails(details);
      return details;
    } catch {
      persistUserDetails(null);
      setUserDetails(null);
      return null;
    }
  }, []);

  const updateUserDetails = useCallback((nextDetails: UserDetails | null) => {
    persistUserDetails(nextDetails);
    setUserDetails(nextDetails);
    return nextDetails;
  }, []);

  const patchUser = useCallback(
    async (values: UpdateProfileRequest) => {
      const updatedProfile = (await window.electron.updateProfile(
        values
      )) as UserProfile;
      const nextUserDetails = mergeUserProfileIntoDetails(
        userDetails,
        updatedProfile
      );

      persistUserDetails(nextUserDetails);
      setUserDetails(nextUserDetails);

      return nextUserDetails;
    },
    [userDetails]
  );

  const unblockUser = useCallback(async (userId: string) => {
    return globalThis.window.electron.hydraApi.post(`/users/${userId}/unblock`);
  }, []);

  useEffect(() => {
    void fetchUserDetails();
  }, [fetchUserDetails]);

  useEffect(() => {
    const unsubscribeAccountUpdated =
      globalThis.window.electron.onAccountUpdated(() => {
        void fetchUserDetails();
      });
    const unsubscribeSignIn = globalThis.window.electron.onSignIn(() => {
      void fetchUserDetails();
    });
    const unsubscribeSignOut = globalThis.window.electron.onSignOut(() => {
      persistUserDetails(null);
      setUserDetails(null);
    });

    return () => {
      unsubscribeAccountUpdated();
      unsubscribeSignIn();
      unsubscribeSignOut();
    };
  }, [fetchUserDetails]);

  const hasActiveSubscription = useMemo(() => {
    const expiresAt = new Date(userDetails?.subscription?.expiresAt ?? 0);
    return expiresAt > new Date();
  }, [userDetails]);

  return {
    userDetails,
    hasActiveSubscription,
    fetchUserDetails,
    updateUserDetails,
    patchUser,
    unblockUser,
  };
}
