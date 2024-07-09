import { Button, Modal, TextField } from "@renderer/components";
import { PendingFriendRequest } from "@types";
import * as styles from "./user.css";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useEffect, useState } from "react";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

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

  const handleAddFriend: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
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

  useEffect(() => {
    setPendingRequests([]);
  });

  const handleSeeProfileClick = () => {
    navigate(`profile/${friendCode}`);
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
        <form
          onSubmit={handleAddFriend}
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            gap: `${SPACING_UNIT * 3}px`,
            width: "350px",
          }}
        >
          <TextField
            label={t("friend_code")}
            value={friendCode}
            required
            minLength={8}
            maxLength={8}
            containerProps={{ style: { width: "100%" } }}
            onChange={(e) => setFriendCode(e.target.value)}
          />
          <Button
            disabled={isAddingFriend}
            style={{ alignSelf: "end" }}
            type="submit"
          >
            {isAddingFriend ? t("sending") : t("send")}
          </Button>
          <Button
            onClick={handleSeeProfileClick}
            disabled={isAddingFriend}
            style={{ alignSelf: "end" }}
            type="button"
          >
            {t("see_profile")}
          </Button>
        </form>

        <div>
          {pendingRequests.map((request) => {
            return (
              <p>
                {request.AId} - {request.BId}
              </p>
            );
          })}
        </div>
      </Modal>
    </>
  );
};
