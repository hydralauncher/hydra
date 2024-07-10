import { Button, Modal, TextField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useState } from "react";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UserFriendRequest } from "./user-friend-request";

export interface UserAddFriendsModalProps {
  visible: boolean;
  onClose: () => void;
}

export const UserAddFriendsModal = ({
  visible,
  onClose,
}: UserAddFriendsModalProps) => {
  const { t } = useTranslation("user_profile");

  const [friendCode, setFriendCode] = useState("");
  const [isAddingFriend, setIsAddingFriend] = useState(false);

  const navigate = useNavigate();

  const { sendFriendRequest, updateFriendRequests, friendRequests } =
    useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  const handleClickAddFriend = () => {
    setIsAddingFriend(true);
    sendFriendRequest(friendCode)
      .then(() => {
        updateFriendRequests();
        showSuccessToast(t("friend_request_sent"));
      })
      .catch(() => {
        showErrorToast("Não foi possível enviar o pedido de amizade");
      })
      .finally(() => {
        setIsAddingFriend(false);
      });
  };

  const handleClickFriend = (userId: string) => {
    navigate(`/user/${userId}`);
  };

  const handleClickSeeProfile = () => {
    onClose();
    navigate(`/user/${friendCode}`);
  };

  const handleClickCancelFriendRequest = (userId: string) => {
    console.log(userId);
    updateFriendRequests();
  };

  const handleClickAcceptFriendRequest = (userId: string) => {
    console.log(userId);
    updateFriendRequests();
  };

  const handleClickRefuseFriendRequest = (userId: string) => {
    console.log(userId);
    updateFriendRequests();
  };

  const resetModal = () => {
    setFriendCode("");
  };

  const cleanFormAndClose = () => {
    resetModal();
    onClose();
  };

  return (
    <>
      <Modal
        visible={visible}
        title={t("add_friends")}
        onClose={cleanFormAndClose}
      >
        <div
          style={{
            display: "flex",
            width: "500px",
            flexDirection: "column",
            gap: `${SPACING_UNIT * 2}px`,
          }}
        >
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
              {isAddingFriend ? t("sending") : t("send")}
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
            <h3>Pendentes</h3>
            {friendRequests?.map((request) => {
              return (
                <UserFriendRequest
                  key={request.userId}
                  displayName={request.displayName}
                  isRequestSent={request.type === "SENT"}
                  profileImageUrl={request.profileImageUrl}
                  userId={request.userId}
                  onClickAcceptRequest={handleClickAcceptFriendRequest}
                  onClickCancelRequest={handleClickCancelFriendRequest}
                  onClickRefuseRequest={handleClickRefuseFriendRequest}
                  onClickRequest={handleClickFriend}
                />
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
};
