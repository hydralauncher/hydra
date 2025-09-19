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
    try {
      // Verificação de segurança para evitar erro quando window.electron é undefined
      if (!window.electron || typeof window.electron.getMe !== "function") {
        console.warn("window.electron.getMe não está disponível ainda");
        return;
      }

      const userDetails = await window.electron.getMe();

      if (userDetails == null) {
        clearUserDetails();
      } else {
        window["userDetails"] = userDetails;
      }

      return userDetails;
    } catch (err) {
      console.error("Erro ao buscar detalhes do usuário:", err);
      return null;
    }
  }, [clearUserDetails]);

  const patchUser = useCallback(
    async (values: UpdateProfileRequest) => {
      if (
        !window.electron ||
        typeof window.electron.updateProfile !== "function"
      ) {
        console.warn("window.electron.updateProfile não está disponível ainda");
        return;
      }

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
    if (
      !window.electron ||
      typeof window.electron.getFriendRequests !== "function"
    ) {
      console.warn(
        "window.electron.getFriendRequests não está disponível ainda"
      );
      return;
    }

    return window.electron
      .getFriendRequests()
      .then((friendRequests) => {
        if (
          window.electron &&
          typeof window.electron.syncFriendRequests === "function"
        ) {
          window.electron.syncFriendRequests();
        }
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
      if (
        !window.electron ||
        typeof window.electron.sendFriendRequest !== "function"
      ) {
        console.warn(
          "window.electron.sendFriendRequest não está disponível ainda"
        );
        return;
      }

      return window.electron
        .sendFriendRequest(userId)
        .then(() => fetchFriendRequests());
    },
    [fetchFriendRequests]
  );

  const updateFriendRequestState = useCallback(
    async (userId: string, action: FriendRequestAction) => {
      if (
        !window.electron ||
        typeof window.electron.updateFriendRequest !== "function"
      ) {
        console.warn(
          "window.electron.updateFriendRequest não está disponível ainda"
        );
        return;
      }

      return window.electron
        .updateFriendRequest(userId, action)
        .then(() => fetchFriendRequests());
    },
    [fetchFriendRequests]
  );

  const undoFriendship = (userId: string) => {
    if (
      !window.electron ||
      typeof window.electron.undoFriendship !== "function"
    ) {
      console.warn("window.electron.undoFriendship não está disponível ainda");
      return Promise.resolve();
    }
    return window.electron.undoFriendship(userId);
  };

  const blockUser = (userId: string) => {
    if (!window.electron || typeof window.electron.blockUser !== "function") {
      console.warn("window.electron.blockUser não está disponível ainda");
      return Promise.resolve();
    }
    return window.electron.blockUser(userId);
  };

  const unblockUser = (userId: string) => {
    if (!window.electron || typeof window.electron.unblockUser !== "function") {
      console.warn("window.electron.unblockUser não está disponível ainda");
      return Promise.resolve();
    }
    return window.electron.unblockUser(userId);
  };

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
