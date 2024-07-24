import {
  CheckCircleIcon,
  PersonIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import * as styles from "./user-friend-modal.css";
import cn from "classnames";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useTranslation } from "react-i18next";

export interface UserFriendItemProps {
  userId: string;
  profileImageUrl: string | null;
  displayName: string;
  type: "SENT" | "RECEIVED" | "ACCEPTED";
  onClickCancelRequest: (userId: string) => void;
  onClickAcceptRequest: (userId: string) => void;
  onClickRefuseRequest: (userId: string) => void;
  onClickItem: (userId: string) => void;
}

export const UserFriendItem = ({
  userId,
  profileImageUrl,
  displayName,
  type,
  onClickCancelRequest,
  onClickAcceptRequest,
  onClickRefuseRequest,
  onClickItem,
}: UserFriendItemProps) => {
  const { t } = useTranslation("user_profile");

  const getRequestDescription = () => {
    if (type === null) return null;

    return (
      <small>
        {type == "SENT" ? t("request_sent") : t("request_received")}
      </small>
    );
  };

  const getRequestActions = () => {
    if (type === "SENT") {
      return (
        <button
          className={styles.cancelRequestButton}
          onClick={() => onClickCancelRequest(userId)}
          title={t("cancel_request")}
        >
          <XCircleIcon size={28} />
        </button>
      );
    }

    if (type === "RECEIVED") {
      return (
        <>
          <button
            className={styles.acceptRequestButton}
            onClick={() => onClickAcceptRequest(userId)}
            title={t("accept_request")}
          >
            <CheckCircleIcon size={28} />
          </button>
          <button
            className={styles.cancelRequestButton}
            onClick={() => onClickRefuseRequest(userId)}
            title={t("ignore_request")}
          >
            <XCircleIcon size={28} />
          </button>
        </>
      );
    }

    return (
      <button
        className={styles.cancelRequestButton}
        onClick={() => onClickCancelRequest(userId)}
        title={t("undo_friendship")}
      >
        <XCircleIcon size={28} />
      </button>
    );
  };

  return (
    <div className={cn(styles.friendListContainer, styles.profileContentBox)}>
      <button
        type="button"
        className={styles.friendListButton}
        onClick={() => onClickItem(userId)}
      >
        <div className={styles.friendAvatarContainer}>
          {profileImageUrl ? (
            <img
              className={styles.profileAvatar}
              alt={displayName}
              src={profileImageUrl}
            />
          ) : (
            <PersonIcon size={24} />
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            flex: "1",
            minWidth: 0,
          }}
        >
          <p className={styles.friendListDisplayName}>{displayName}</p>
          {getRequestDescription()}
        </div>
      </button>

      <div
        style={{
          position: "absolute",
          right: "8px",
          display: "flex",
          gap: `${SPACING_UNIT}px`,
        }}
      >
        {getRequestActions()}
      </div>
    </div>
  );
};
