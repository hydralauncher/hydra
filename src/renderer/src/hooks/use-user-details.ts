import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  setProfileBackground,
  setUserDetails,
  setFriendRequests,
  setFriendsModalVisible,
  setFriendsModalHidden,
} from "@renderer/features";
// import { profileBackgroundFromProfileImage } from "@renderer/helpers";
import type {
  FriendRequestAction,
  UpdateProfileRequest,
  UserDetails,
} from "@types";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import { logger } from "@renderer/logger";

export function useUserDetails() {
  const dispatch = useAppDispatch();

  const {
    userDetails,
    profileBackground,
    friendRequests,
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

      if (userDetails.profileImageUrl) {
        // const profileBackground = await profileBackgroundFromProfileImage(
        //   userDetails.profileImageUrl
        // ).catch((err) => {
        //   logger.error("profileBackgroundFromProfileImage", err);
        //   return `#151515B3`;
        // });
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
    async (values: UpdateProfileRequest) => {
      console.log("values", values);
      const response = await window.electron.updateProfile(values);
      return updateUserDetails(response);
    },
    [updateUserDetails]
  );

  const fetchFriendRequests = useCallback(() => {
    return window.electron
      .getFriendRequests()
      .then((friendRequests) => {
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

  const undoFriendship = (userId: string) => {
    return window.electron.undoFriendship(userId);
  };

  const blockUser = (userId: string) => {
    return window.electron.blockUser(userId);
  };

  const unblockUser = (userId: string) => {
    return window.electron.unblockUser(userId);
  };

  return {
    userDetails,
    profileBackground,
    friendRequests,
    friendRequetsModalTab,
    isFriendsModalVisible,
    friendModalUserId,
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
