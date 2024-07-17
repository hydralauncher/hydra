import { useCallback } from "react";
import { average } from "color.js";

import { useAppDispatch, useAppSelector } from "./redux";
import {
  setProfileBackground,
  setUserDetails,
  setFriendRequests,
  setshowFriendsModal,
  setFriendRequestsModal,
} from "@renderer/features";
import { darkenColor } from "@renderer/helpers";
import { FriendRequestAction, UserDetails } from "@types";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";

export function useUserDetails() {
  const dispatch = useAppDispatch();

  const {
    userDetails,
    profileBackground,
    friendRequests,
    showFriendsModal,
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
        const output = await average(userDetails.profileImageUrl, {
          amount: 1,
          format: "hex",
        });

        const profileBackground = `linear-gradient(135deg, ${darkenColor(output as string, 0.6)}, ${darkenColor(output as string, 0.8, 0.7)})`;
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

  const updateFriendRequests = useCallback(async () => {
    const friendRequests = await window.electron.getFriendRequests();
    dispatch(setFriendRequests(friendRequests));
  }, [dispatch]);

  const setShowFriendsModal = useCallback(
    (showModal: boolean, tab: UserFriendModalTab | null) => {
      dispatch(setFriendRequestsModal(tab));
      dispatch(setshowFriendsModal(showModal));

      if (showModal) {
        updateFriendRequests();
      }
    },
    [dispatch]
  );

  const sendFriendRequest = useCallback(
    async (userId: string) => {
      return window.electron
        .sendFriendRequest(userId)
        .then(() => updateFriendRequests());
    },
    [updateFriendRequests]
  );

  const updateFriendRequestState = useCallback(
    async (userId: string, action: FriendRequestAction) => {
      return window.electron
        .updateFriendRequest(userId, action)
        .then(() => updateFriendRequests());
    },
    [updateFriendRequests]
  );

  return {
    userDetails,
    profileBackground,
    friendRequests,
    showFriendsModal,
    friendRequetsModalTab,
    fetchUserDetails,
    signOut,
    clearUserDetails,
    updateUserDetails,
    patchUser,
    sendFriendRequest,
    updateFriendRequests,
    updateFriendRequestState,
    setShowFriendsModal,
  };
}
