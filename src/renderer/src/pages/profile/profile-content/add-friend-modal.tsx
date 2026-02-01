import { Avatar, Button, Modal, TextField } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Copy } from "iconsax-reactjs";
import "./add-friend-modal.scss";

interface AddFriendModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function AddFriendModal({ visible, onClose }: AddFriendModalProps) {
  const { t } = useTranslation("user_profile");
  const navigate = useNavigate();

  const [friendCode, setFriendCode] = useState("");
  const [isAddingFriend, setIsAddingFriend] = useState(false);

  const {
    sendFriendRequest,
    updateFriendRequestState,
    friendRequests,
    fetchFriendRequests,
    userDetails,
  } = useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  const copyMyFriendCode = () => {
    if (userDetails?.id) {
      navigator.clipboard.writeText(userDetails.id);
      showSuccessToast(t("friend_code_copied"));
    }
  };

  useEffect(() => {
    if (visible) {
      setFriendCode("");
      fetchFriendRequests();
    }
  }, [visible, fetchFriendRequests]);

  const handleChangeFriendCode = (e: React.ChangeEvent<HTMLInputElement>) => {
    const code = e.target.value.trim().slice(0, 8);
    setFriendCode(code);
  };

  const validateFriendCode = (callback: () => void) => {
    if (friendCode.length === 8) {
      return callback();
    }

    showErrorToast(t("friend_code_length_error"));
  };

  const handleClickAddFriend = () => {
    setIsAddingFriend(true);
    sendFriendRequest(friendCode)
      .then(() => {
        setFriendCode("");
        showSuccessToast(t("request_sent"));
      })
      .catch(() => {
        showErrorToast(t("error_adding_friend"));
      })
      .finally(() => {
        setIsAddingFriend(false);
      });
  };

  const handleClickSeeProfile = () => {
    if (friendCode.length === 8) {
      onClose();
      navigate(`/profile/${friendCode}`);
    }
  };

  const handleClickRequest = (userId: string) => {
    onClose();
    navigate(`/profile/${userId}`);
  };

  const handleCancelFriendRequest = (userId: string) => {
    updateFriendRequestState(userId, "CANCEL").catch(() => {
      showErrorToast(t("try_again"));
    });
  };

  const sentRequests = friendRequests.filter((req) => req.type === "SENT");
  const currentRequest =
    friendCode.length === 8
      ? sentRequests.find((req) => req.id === friendCode)
      : null;

  return (
    <Modal visible={visible} title={t("add_friends")} onClose={onClose}>
      <div className="add-friend-modal">
        {userDetails?.id && (
          <div className="add-friend-modal__my-code">
            <span className="add-friend-modal__my-code-label">
              {t("your_friend_code")}
            </span>
            <span className="add-friend-modal__my-code-value">
              {userDetails.id}
            </span>
            <button
              onClick={copyMyFriendCode}
              type="button"
              className="add-friend-modal__copy-icon-button"
              title={t("copy_friend_code")}
            >
              <Copy size={16} variant="Linear" />
            </button>
          </div>
        )}

        <div className="add-friend-modal__actions">
          <TextField
            label={t("friend_code")}
            value={friendCode}
            containerProps={{ style: { flex: 1 } }}
            onChange={handleChangeFriendCode}
          />
          <Button
            disabled={isAddingFriend}
            type="button"
            className="add-friend-modal__button"
            onClick={() => validateFriendCode(handleClickAddFriend)}
          >
            {isAddingFriend ? t("sending") : t("add")}
          </Button>
          <Button
            theme="outline"
            onClick={() => validateFriendCode(handleClickSeeProfile)}
            disabled={isAddingFriend}
            className="add-friend-modal__button"
            type="button"
          >
            {t("see_profile")}
          </Button>
        </div>
        {currentRequest && (
          <div className="add-friend-modal__pending-status">{t("pending")}</div>
        )}

        {sentRequests.length > 0 && (
          <div className="add-friend-modal__pending-container">
            <h3>{t("pending")}</h3>
            <div className="add-friend-modal__pending-list">
              {sentRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  className="add-friend-modal__friend-item"
                  onClick={() => handleClickRequest(request.id)}
                >
                  <Avatar
                    src={request.profileImageUrl}
                    alt={request.displayName}
                    size={40}
                  />
                  <span className="add-friend-modal__friend-name">
                    {request.displayName}
                  </span>
                  <Button
                    theme="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCancelFriendRequest(request.id);
                    }}
                    type="button"
                  >
                    {t("cancel_request")}
                  </Button>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
