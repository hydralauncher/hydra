import { Button, Modal, TextField } from "@renderer/components";
import { PendingFriendRequest } from "@types";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useEffect, useState } from "react";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { UserFriendPendingRequest } from "./user-friend-pending-request";

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
  const [pendingRequests, setPendingRequests] = useState<
    PendingFriendRequest[]
  >([]);

  const navigate = useNavigate();

  const { sendFriendRequest } = useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  const handleClickAddFriend = () => {
    setIsAddingFriend(true);
    sendFriendRequest(friendCode)
      .then(() => {
        showSuccessToast(t("friend_request_sent"));
      })
      .catch(() => {
        showErrorToast("falhaaaa");
      })
      .finally(() => {
        setIsAddingFriend(false);
      });
  };

  const handleClickFriend = (userId: string) => {
    navigate(userId);
  };

  useEffect(() => {
    setPendingRequests([
      {
        userId: "abcd1234",
        displayName: "Punheta Master 123",
        profileImageUrl:
          "https://cdn.discordapp.com/avatars/1239959140785455295/4aff4b901c7a9f5f814b4379b6cfd58a.webp",
        type: "RECEIVED",
      },
      {
        userId: "12345678",
        displayName: "Deyvis0n",
        profileImageUrl: null,
        type: "SENT",
      },
    ]);
  }, []);

  const handleClickSeeProfile = () => {
    // navigate(`profile/${friendCode}`);
  };

  const handleClickCancelFriendRequest = (userId: string) => {
    console.log(userId);
  };

  const handleClickAcceptFriendRequest = (userId: string) => {
    console.log(userId);
  };

  const handleClickRefuseFriendRequest = (userId: string) => {
    console.log(userId);
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
            {pendingRequests.map((request) => {
              return (
                <UserFriendPendingRequest
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
