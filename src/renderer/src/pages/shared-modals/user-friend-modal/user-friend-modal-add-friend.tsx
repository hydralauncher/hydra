import { Button, TextField } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UserFriendItem } from "./user-friend-item";
import "./user-friend-modal-add-friend.scss";

export interface UserFriendModalAddFriendProps {
  closeModal: () => void;
}

export const UserFriendModalAddFriend = ({
  closeModal,
}: UserFriendModalAddFriendProps) => {
  const { t } = useTranslation("user_profile");

  const [friendCode, setFriendCode] = useState("");
  const [isAddingFriend, setIsAddingFriend] = useState(false);

  const navigate = useNavigate();

  const { sendFriendRequest, updateFriendRequestState, friendRequests } =
    useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  const handleClickAddFriend = () => {
    setIsAddingFriend(true);
    sendFriendRequest(friendCode)
      .then(() => {
        setFriendCode("");
      })
      .catch(() => {
        showErrorToast(t("error_adding_friend"));
      })
      .finally(() => {
        setIsAddingFriend(false);
      });
  };

  const handleClickRequest = (userId: string) => {
    closeModal();
    navigate(`/profile/${userId}`);
  };

  const handleClickSeeProfile = () => {
    if (friendCode.length === 8) {
      closeModal();
      navigate(`/profile/${friendCode}`);
    }
  };

  const validateFriendCode = (callback: () => void) => {
    if (friendCode.length === 8) {
      return callback();
    }

    showErrorToast(t("friend_code_length_error"));
  };

  const handleCancelFriendRequest = (userId: string) => {
    updateFriendRequestState(userId, "CANCEL").catch(() => {
      showErrorToast(t("try_again"));
    });
  };

  const handleAcceptFriendRequest = (userId: string) => {
    updateFriendRequestState(userId, "ACCEPTED")
      .then(() => {
        showSuccessToast(t("request_accepted"));
      })
      .catch(() => {
        showErrorToast(t("try_again"));
      });
  };

  const handleRefuseFriendRequest = (userId: string) => {
    updateFriendRequestState(userId, "REFUSED").catch(() => {
      showErrorToast(t("try_again"));
    });
  };

  const handleChangeFriendCode = (e: React.ChangeEvent<HTMLInputElement>) => {
    const friendCode = e.target.value.trim().slice(0, 8);
    setFriendCode(friendCode);
  };

  return (
    <>
      <div className="user-friend-modal-add-friend__actions">
        <TextField
          label={t("friend_code")}
          value={friendCode}
          containerProps={{ style: { width: "100%" } }}
          onChange={handleChangeFriendCode}
        />
        <Button
          disabled={isAddingFriend}
          className="user-friend-modal-add-friend__button"
          type="button"
          onClick={() => validateFriendCode(handleClickAddFriend)}
        >
          {isAddingFriend ? t("sending") : t("add")}
        </Button>

        <Button
          onClick={() => validateFriendCode(handleClickSeeProfile)}
          disabled={isAddingFriend}
          className="user-friend-modal-add-friend__button"
          type="button"
        >
          {t("see_profile")}
        </Button>
      </div>

      <div className="user-friend-modal-add-friend__pending-container">
        <h3>{t("pending")}</h3>
        {friendRequests.length === 0 && <p>{t("no_pending_invites")}</p>}
        {friendRequests.map((request) => {
          return (
            <UserFriendItem
              key={request.id}
              displayName={request.displayName}
              type={request.type}
              profileImageUrl={request.profileImageUrl}
              userId={request.id}
              onClickAcceptRequest={handleAcceptFriendRequest}
              onClickCancelRequest={handleCancelFriendRequest}
              onClickRefuseRequest={handleRefuseFriendRequest}
              onClickItem={handleClickRequest}
            />
          );
        })}
      </div>
    </>
  );
};
