import { useCallback, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  setProfileBackground,
  setUserDetails,
  setFriendRequests,
  setFriendsModalVisible,
  setFriendsModalHidden,
} from "@renderer/features";
import type {
  FriendRequestAction,
  UpdateProfileRequest,
  UserDetails,
} from "@types";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";

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
    [
      updateUserDetails,
      userDetails?.username,
      userDetails?.subscription,
      userDetails?.featurebaseJwt,
    ]
  );

  const fetchFriendRequests = useCallback(async () => {
    return window.electron
      .getFriendRequests()
      .then((friendRequests) => {
        window.electron.syncFriendRequests();
        dispatch(setFriendRequests(friendRequests));
      })
      .catch(() => {});
  }, [dispatch]);

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
    const expiresAt = new Date(userDetails?.subscription?.expiresAt ?? 0);
    return expiresAt > new Date();
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
    updateFriendRequestState,
    blockUser,
    unblockUser,
    undoFriendship,
  };
}
