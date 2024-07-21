import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  setProfileBackground,
  setUserDetails,
  setFriendRequests,
  setFriendsModalVisible,
  setFriendsModalHidden,
} from "@renderer/features";
import { profileBackgroundFromProfileImage } from "@renderer/helpers";
import { FriendRequestAction, UserDetails } from "@types";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";

export function useUserDetails() {
  const dispatch = useAppDispatch();

  const {
    userDetails,
    profileBackground,
    friendRequests,
    isFriendsModalVisible,
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

      if (userDetails.profileImageUrl) {
        const profileBackground = await profileBackgroundFromProfileImage(
          userDetails.profileImageUrl
        );
        dispatch(setProfileBackground(profileBackground));

        window.localStorage.setItem(
          "userDetails",
          JSON.stringify({ ...userDetails, profileBackground })
        );
      } else {
        const profileBackground = `#151515B3`;
        dispatch(setProfileBackground(profileBackground));

        window.localStorage.setItem(
          "userDetails",
          JSON.stringify({ ...userDetails, profileBackground })
        );
      }
    },
    [dispatch]
  );

  const fetchUserDetails = useCallback(async () => {
    return window.electron.getMe().then((userDetails) => {
      if (userDetails == null) {
        clearUserDetails();
      }

      return userDetails;
    });
  }, [clearUserDetails]);

  const patchUser = useCallback(
    async (displayName: string, imageProfileUrl: string | null) => {
      const response = await window.electron.updateProfile(
        displayName,
        imageProfileUrl
      );

      return updateUserDetails(response);
    },
    [updateUserDetails]
  );

  const fetchFriendRequests = useCallback(async () => {
    const friendRequests = await window.electron.getFriendRequests();
    dispatch(setFriendRequests(friendRequests));
  }, [dispatch]);

  const showFriendsModal = useCallback(
    (tab: UserFriendModalTab) => {
      dispatch(setFriendsModalVisible(tab));
      fetchFriendRequests();
    },
    [dispatch]
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

  return {
    userDetails,
    profileBackground,
    friendRequests,
    friendRequetsModalTab,
    isFriendsModalVisible,
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
  };
}
