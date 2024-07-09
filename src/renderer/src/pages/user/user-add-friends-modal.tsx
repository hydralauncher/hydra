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

  const { userDetails, sendFriendRequest } = useUserDetails();

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
        AId: "abcd1234",
        ADisplayName: "Punheta Master 123",
        AProfileImageUrl:
          "https://cdn.discordapp.com/avatars/1239959140785455295/4aff4b901c7a9f5f814b4379b6cfd58a.webp",
        BId: "BMmNRmP3",
        BDisplayName: "Hydra",
        BProfileImageUrl: null,
      },
      {
        AId: "BMmNRmP3",
        ADisplayName: "Hydra",
        AProfileImageUrl: null,
        BId: "12345678",
        BDisplayName: "Deyvis0n",
        BProfileImageUrl: null,
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
              if (request.AId === userDetails?.id) {
                return (
                  <UserFriendPendingRequest
                    key={request.AId}
                    displayName={request.BDisplayName}
                    isRequestSent={true}
                    profileImageUrl={request.BProfileImageUrl}
                    userId={request.BId}
                    onClickAcceptRequest={handleClickAcceptFriendRequest}
                    onClickCancelRequest={handleClickCancelFriendRequest}
                    onClickRefuseRequest={handleClickRefuseFriendRequest}
                    onClickRequest={handleClickFriend}
                  />
                );
              }

              return (
                <UserFriendPendingRequest
                  key={request.BId}
                  displayName={request.ADisplayName}
                  isRequestSent={false}
                  profileImageUrl={request.AProfileImageUrl}
                  userId={request.AId}
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
