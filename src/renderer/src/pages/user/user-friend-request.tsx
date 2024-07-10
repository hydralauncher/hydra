import {
  CheckCircleIcon,
  PersonIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import * as styles from "./user.css";
import cn from "classnames";

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
  return (
    <button
      type="button"
      className={cn(styles.friendListItem, styles.profileContentBox)}
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
        <small>{isRequestSent ? "Pedido enviado" : "Pedido recebido"}</small>
      </div>
      {isRequestSent ? (
        <button
          className={styles.cancelRequestButton}
          onClick={() => onClickCancelRequest(userId)}
        >
          <XCircleIcon size={28} />
        </button>
      ) : (
        <>
          <button
            className={styles.acceptRequestButton}
            onClick={() => onClickAcceptRequest(userId)}
          >
            <CheckCircleIcon size={28} />
          </button>
          <button
            className={styles.cancelRequestButton}
            onClick={() => onClickRefuseRequest(userId)}
          >
            <XCircleIcon size={28} />
          </button>
        </>
      )}
    </button>
  );
};
