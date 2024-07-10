import {
  CheckCircleIcon,
  PersonIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import { SPACING_UNIT } from "@renderer/theme.css";
import * as styles from "./user.css";
import cn from "classnames";

export interface UserFriendPendingRequestProps {
  userId: string;
  profileImageUrl: string | null;
  displayName: string;
  isRequestSent: boolean;
  onClickCancelRequest: (userId: string) => void;
  onClickAcceptRequest: (userId: string) => void;
  onClickRefuseRequest: (userId: string) => void;
  onClickRequest: (userId: string) => void;
}

export const UserFriendPendingRequest = ({
  userId,
  profileImageUrl,
  displayName,
  isRequestSent,
  onClickCancelRequest,
  onClickAcceptRequest,
  onClickRefuseRequest,
  onClickRequest,
}: UserFriendPendingRequestProps) => {
  return (
    <button
      type="button"
      className={cn(styles.friendListItem, styles.profileContentBox)}
      onClick={() => onClickRequest(userId)}
      style={{
        padding: "8px",
      }}
    >
      <div className={styles.pendingFriendRequestAvatarContainer}>
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
          gap: `${SPACING_UNIT / 2}px`,
        }}
      >
        <h4>{displayName}</h4>
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
