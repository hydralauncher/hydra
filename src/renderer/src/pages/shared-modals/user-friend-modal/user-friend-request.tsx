import {
  CheckCircleIcon,
  PersonIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import * as styles from "./user-friend-modal.css";
import cn from "classnames";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useTranslation } from "react-i18next";

export interface UserFriendRequestProps {
  userId: string;
  profileImageUrl: string | null;
  displayName: string;
  isRequestSent: boolean;
  onClickCancelRequest: (userId: string) => void;
  onClickAcceptRequest: (userId: string) => void;
  onClickRefuseRequest: (userId: string) => void;
  onClickRequest: (userId: string) => void;
}

export const UserFriendRequest = ({
  userId,
  profileImageUrl,
  displayName,
  isRequestSent,
  onClickCancelRequest,
  onClickAcceptRequest,
  onClickRefuseRequest,
  onClickRequest,
}: UserFriendRequestProps) => {
  const { t } = useTranslation("user_profile");

  return (
    <div className={cn(styles.friendListContainer, styles.profileContentBox)}>
      <button
        type="button"
        className={styles.friendListButton}
        onClick={() => onClickRequest(userId)}
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
          <small>
            {isRequestSent ? t("request_sent") : t("request_received")}
          </small>
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
        {isRequestSent ? (
          <button
            className={styles.cancelRequestButton}
            onClick={() => onClickCancelRequest(userId)}
            title={t("cancel_request")}
          >
            <XCircleIcon size={28} />
          </button>
        ) : (
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
        )}
      </div>
    </div>
  );
};
