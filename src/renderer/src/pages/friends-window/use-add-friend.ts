import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { useToast, useUserDetails } from "@renderer/hooks";
import {
  FRIEND_CODE_LENGTH,
  getAddFriendErrorKey,
  isUserNotFoundError,
  normalizeFriendCode,
} from "./add-friend-errors";

interface UseAddFriendOptions {
  isFriend: (userId: string) => boolean;
  onOpenProfile: (userId: string) => void;
}

export function useAddFriend({ isFriend, onOpenProfile }: UseAddFriendOptions) {
  const { t } = useTranslation("friends_window");
  const { t: tProfile } = useTranslation("user_profile");
  const { userDetails, sendFriendRequest, updateFriendRequestState } =
    useUserDetails();
  const toast = useToast();

  const showToastPreferringMainWindow = (
    type: "success" | "error",
    title: string
  ) => {
    void globalThis.window.electron
      .showToastInMainWindow({ type, title })
      .catch(() => false)
      .then((shownInMainWindow) => {
        if (shownInMainWindow) return;
        if (type === "success") toast.showSuccessToast(title);
        else toast.showErrorToast(title);
      });
  };
  const showSuccessToast = (title: string) =>
    showToastPreferringMainWindow("success", title);
  const showErrorToast = (title: string) =>
    showToastPreferringMainWindow("error", title);

  const [friendCode, setFriendCode] = useState("");
  const [isSending, setIsSending] = useState(false);

  const changeFriendCode = useCallback((value: string) => {
    setFriendCode(normalizeFriendCode(value));
  }, []);

  const hasCompleteCode = () => {
    if (friendCode.length === FRIEND_CODE_LENGTH) return true;

    showErrorToast(tProfile("friend_code_length_error"));
    return false;
  };

  const sendRequest = async () => {
    if (isSending || !hasCompleteCode()) return;

    if (userDetails?.id === friendCode) {
      showErrorToast(t("cannot_add_yourself"));
      return;
    }

    if (isFriend(friendCode)) {
      showErrorToast(t("already_friends"));
      return;
    }

    setIsSending(true);
    try {
      await sendFriendRequest(friendCode);
      setFriendCode("");
      showSuccessToast(tProfile("request_sent"));
    } catch (error) {
      const errorKey = getAddFriendErrorKey(error);
      showErrorToast(errorKey ? t(errorKey) : tProfile("error_adding_friend"));
    } finally {
      setIsSending(false);
    }
  };

  const openProfile = async () => {
    if (!hasCompleteCode()) return;

    const exists = await globalThis.window.electron.hydraApi
      .get(`/users/${friendCode}`)
      .then(() => true)
      .catch((error: unknown) => !isUserNotFoundError(error));

    if (!exists) {
      showErrorToast(t("friend_code_not_found"));
      return;
    }

    onOpenProfile(friendCode);
  };

  const cancelSentRequest = (userId: string) => {
    updateFriendRequestState(userId, "CANCEL").catch(() => {
      showErrorToast(tProfile("try_again"));
    });
  };

  return {
    friendCode,
    changeFriendCode,
    isSending,
    sendRequest,
    openProfile,
    cancelSentRequest,
  };
}
