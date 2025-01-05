import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  setProfileBackground,
  setUserDetails,
  setFriendRequests,
  setFriendsModalVisible,
  setFriendsModalHidden,
  setFriendRequestCount,
} from "@renderer/features";
import type {
  FriendRequestAction,
  UpdateProfileRequest,
  UserDetails,
} from "@types";
import * as Sentry from "@sentry/react";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import { isFuture, isToday } from "date-fns";

export function useUserDetails() {
  const dispatch = useAppDispatch();

  const {
    userDetails,
    profileBackground,
    friendRequests,
    friendRequestCount,
    isFriendsModalVisible,
    friendModalUserId,
    friendRequetsModalTab,
  } = useAppSelector((state) => state.userDetails);

  const clearUserDetails = useCallback(async () => {
    Sentry.setUser(null);

    dispatch(setUserDetails(null));
    dispatch(setProfileBackground(null));

    window.localStorage.removeItem("userDetails");
  }, [dispatch]);

  const signOut = useCallback(async () => {
    clearUserDetails();

    return window.electron.signOut();
  }, [clearUserDetails]);

  const updateUserDetails = useCallback(
    async (userDetails: UserDetails) => {
      Sentry.setUser({
        id: userDetails.id,
        username: userDetails.username,
        email: userDetails.email ?? undefined,
      });

      dispatch(setUserDetails(userDetails));
      window.localStorage.setItem("userDetails", JSON.stringify(userDetails));
    },
    [dispatch]
  );

  const fetchUserDetails = useCallback(async () => {
    return window.electron.getMe().then((userDetails) => {
      if (userDetails == null) {
        clearUserDetails();
      }

      window["userDetails"] = userDetails;

      return userDetails;
    });
  }, [clearUserDetails]);

  const patchUser = useCallback(
    async (values: UpdateProfileRequest) => {
      const response = await window.electron.updateProfile(values);
      return updateUserDetails({
        ...response,
        username: userDetails?.username || "",
        subscription: userDetails?.subscription || null,
        featurebaseJwt: userDetails?.featurebaseJwt || "",
      });
    },
    [updateUserDetails, userDetails?.username, userDetails?.subscription]
  );

  const syncFriendRequests = useCallback(async () => {
    return window.electron
      .syncFriendRequests()
      .then((sync) => {
        dispatch(setFriendRequestCount(sync.friendRequestCount));
      })
      .catch(() => {});
  }, [dispatch]);

  const fetchFriendRequests = useCallback(async () => {
    return window.electron
      .getFriendRequests()
      .then((friendRequests) => {
        syncFriendRequests();
        dispatch(setFriendRequests(friendRequests));
      })
      .catch(() => {});
  }, [dispatch, syncFriendRequests]);

  const showFriendsModal = useCallback(
    (initialTab: UserFriendModalTab, userId: string) => {
      dispatch(setFriendsModalVisible({ initialTab, userId }));
      fetchFriendRequests();
    },
    [dispatch, fetchFriendRequests]
  );

  const hideFriendsModal = useCallback(() => {
    dispatch(setFriendsModalHidden());
  }, [dispatch]);

  const sendFriendRequest = useCallback(
    async (userId: string) => {
      return window.electron
        .sendFriendRequest(userId)
        .then(() => fetchFriendRequests());
    },
    [fetchFriendRequests]
  );

  const updateFriendRequestState = useCallback(
    async (userId: string, action: FriendRequestAction) => {
      return window.electron
        .updateFriendRequest(userId, action)
        .then(() => fetchFriendRequests());
    },
    [fetchFriendRequests]
  );

  const undoFriendship = (userId: string) =>
    window.electron.undoFriendship(userId);

  const blockUser = (userId: string) => window.electron.blockUser(userId);

  const unblockUser = (userId: string) => window.electron.unblockUser(userId);

  const hasActiveSubscription = useMemo(() => {
    const expiresAt = userDetails?.subscription?.expiresAt;
    return expiresAt && (isFuture(expiresAt) || isToday(expiresAt));
  }, [userDetails]);

  return {
    userDetails,
    profileBackground,
    friendRequests,
    friendRequestCount,
    friendRequetsModalTab,
    isFriendsModalVisible,
    friendModalUserId,
    hasActiveSubscription,
    showFriendsModal,
    hideFriendsModal,
    fetchUserDetails,
    signOut,
    clearUserDetails,
    updateUserDetails,
    patchUser,
    sendFriendRequest,
    fetchFriendRequests,
    syncFriendRequests,
    updateFriendRequestState,
    blockUser,
    unblockUser,
    undoFriendship,
  };
}
