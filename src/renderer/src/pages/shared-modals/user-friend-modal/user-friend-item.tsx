import {
  CheckCircleIcon,
  PersonIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import * as styles from "./user-friend-modal.css";
import cn from "classnames";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useTranslation } from "react-i18next";

export type UserFriendItemProps = {
  userId: string;
  profileImageUrl: string | null;
  displayName: string;
} & (
  | {
      type: "ACCEPTED";
      onClickUndoFriendship: (userId: string) => void;
      onClickItem: (userId: string) => void;
    }
  | { type: "BLOCKED"; onClickUnblock: (userId: string) => void }
  | {
      type: "SENT" | "RECEIVED";
      onClickCancelRequest: (userId: string) => void;
      onClickAcceptRequest: (userId: string) => void;
      onClickRefuseRequest: (userId: string) => void;
      onClickItem: (userId: string) => void;
    }
  | { type: null; onClickItem: (userId: string) => void }
);

export const UserFriendItem = (props: UserFriendItemProps) => {
  const { t } = useTranslation("user_profile");
  const { userId, profileImageUrl, displayName, type } = props;

  const getRequestDescription = () => {
    if (type === "ACCEPTED" || type === null) return null;

    return (
      <small>
        {type == "SENT" ? t("request_sent") : t("request_received")}
      </small>
    );
  };

  const getRequestActions = () => {
    if (type === null) return null;

    if (type === "SENT") {
      return (
        <button
          className={styles.cancelRequestButton}
          onClick={() => props.onClickCancelRequest(userId)}
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
            onClick={() => props.onClickAcceptRequest(userId)}
            title={t("accept_request")}
          >
            <CheckCircleIcon size={28} />
          </button>
          <button
            className={styles.cancelRequestButton}
            onClick={() => props.onClickRefuseRequest(userId)}
            title={t("ignore_request")}
          >
            <XCircleIcon size={28} />
          </button>
        </>
      );
    }

    if (type === "ACCEPTED") {
      return (
        <button
          className={styles.cancelRequestButton}
          onClick={() => props.onClickUndoFriendship(userId)}
          title={t("undo_friendship")}
        >
          <XCircleIcon size={28} />
        </button>
      );
    }

    if (type === "BLOCKED") {
      return (
        <button
          className={styles.cancelRequestButton}
          onClick={() => props.onClickUnblock(userId)}
          title={t("unblock")}
        >
          <XCircleIcon size={28} />
        </button>
      );
    }

    return null;
  };

  if (type === "BLOCKED") {
    return (
      <div className={cn(styles.friendListContainer, styles.profileContentBox)}>
        <div className={styles.friendListButton} style={{ cursor: "inherit" }}>
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
          </div>
        </div>

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
  }

  return (
    <div className={cn(styles.friendListContainer, styles.profileContentBox)}>
      <button
        type="button"
        className={styles.friendListButton}
        onClick={() => props.onClickItem(userId)}
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
