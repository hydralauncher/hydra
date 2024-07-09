import { CheckCircleIcon, XCircleIcon } from "@primer/octicons-react";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
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
        display: "flex",
        flexDirection: "row",
        gap: `${SPACING_UNIT}px`,
        alignItems: "center",
      }}
    >
      <img
        style={{ width: "32px", borderRadius: "50%" }}
        src={profileImageUrl || ""}
      />
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
          style={{ color: vars.color.body }}
          onClick={() => onClickCancelRequest(userId)}
        >
          <XCircleIcon size={28} className={styles.cancelRequestButton} />
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
