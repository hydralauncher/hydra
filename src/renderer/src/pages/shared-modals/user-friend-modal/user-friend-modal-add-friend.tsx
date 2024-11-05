import { Button, TextField } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UserFriendItem } from "./user-friend-item";

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
        // TODO: add validation for this input?
        setFriendCode("");
      })
      .catch(() => {
        showErrorToast("Não foi possível enviar o pedido de amizade");
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
    closeModal();
    if (friendCode.length === 8) {
      navigate(`/profile/${friendCode}`);
    }
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

  return (
    <>
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          justifyContent: "center",
          alignItems: "center",
          gap: `${SPACING_UNIT}px`,
        }}
      >
        <TextField
          label={t("friend_code")}
          value={friendCode}
          minLength={8}
          maxLength={8}
          containerProps={{ style: { width: "100%" } }}
          onChange={(e) => setFriendCode(e.target.value)}
        />
        <Button
          disabled={isAddingFriend}
          style={{ alignSelf: "end" }}
          type="button"
          onClick={handleClickAddFriend}
        >
          {isAddingFriend ? t("sending") : t("add")}
        </Button>

        <Button
          onClick={handleClickSeeProfile}
          disabled={isAddingFriend}
          style={{ alignSelf: "end" }}
          type="button"
        >
          {t("see_profile")}
        </Button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: `${SPACING_UNIT * 2}px`,
        }}
      >
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
