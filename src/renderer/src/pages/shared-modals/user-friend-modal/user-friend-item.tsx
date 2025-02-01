import { CheckCircleIcon, XCircleIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@renderer/components";
import "./user-friend-item.scss";

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
        {type === "SENT" ? t("request_sent") : t("request_received")}
      </small>
    );
  };

  const getRequestActions = () => {
    if (type === null) return null;

    if (type === "SENT") {
      return (
        <button
          className="user-friend-item__cancel-button"
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
            className="user-friend-item__accept-button"
            onClick={() => props.onClickAcceptRequest(userId)}
            title={t("accept_request")}
          >
            <CheckCircleIcon size={28} />
          </button>
          <button
            className="user-friend-item__cancel-button"
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
          className="user-friend-item__cancel-button"
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
          className="user-friend-item__cancel-button"
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
      <div className="user-friend-item__container">
        <div className="user-friend-item__button">
          <Avatar size={35} src={profileImageUrl} alt={displayName} />
          <div className="user-friend-item__button__content">
            <p className="user-friend-item__display-name">{displayName}</p>
          </div>
        </div>
        <div className="user-friend-item__button__actions">
          {getRequestActions()}
        </div>
      </div>
    );
  }

  return (
    <div className="user-friend-item__container">
      <button
        type="button"
        className="user-friend-item__button"
        onClick={() => props.onClickItem(userId)}
      >
        <Avatar size={35} src={profileImageUrl} alt={displayName} />
        <div className="user-friend-item__button__content">
          <p className="user-friend-item__display-name">{displayName}</p>

          {getRequestDescription()}
        </div>
      </button>
      <div className="user-friend-item__button__actions">
        {getRequestActions()}
      </div>
    </div>
  );
};
