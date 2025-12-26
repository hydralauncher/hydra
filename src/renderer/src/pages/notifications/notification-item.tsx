import { useCallback, useMemo } from "react";
import {
  XIcon,
  PersonIcon,
  ClockIcon,
  StarFillIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@renderer/components";
import { useDate, useUserDetails } from "@renderer/hooks";
import cn from "classnames";

import type { Notification, Badge } from "@types";
import "./notification-item.scss";

const parseNotificationUrl = (notificationUrl: string): string => {
  const url = new URL(notificationUrl, "http://localhost");
  const userId = url.searchParams.get("userId");
  const badgeName = url.searchParams.get("name");
  const gameTitle = url.searchParams.get("title");
  const showReviews = url.searchParams.get("reviews");

  if (url.pathname === "/profile" && userId) {
    return `/profile/${userId}`;
  }

  if (url.pathname === "/badges" && badgeName) {
    return `/badges/${badgeName}`;
  }

  if (url.pathname.startsWith("/game/")) {
    const params = new URLSearchParams();
    if (gameTitle) params.set("title", gameTitle);
    if (showReviews) params.set("reviews", showReviews);
    const queryString = params.toString();
    return queryString ? `${url.pathname}?${queryString}` : url.pathname;
  }

  return notificationUrl;
};

interface NotificationItemProps {
  notification: Notification;
  badges: Badge[];
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
  onAcceptFriendRequest?: (senderId: string) => void;
  onRefuseFriendRequest?: (senderId: string) => void;
}

export function NotificationItem({
  notification,
  badges,
  onDismiss,
  onMarkAsRead,
  onAcceptFriendRequest,
  onRefuseFriendRequest,
}: Readonly<NotificationItemProps>) {
  const { t } = useTranslation("notifications_page");
  const { formatDistance } = useDate();
  const navigate = useNavigate();
  const { updateFriendRequestState } = useUserDetails();

  const badge = useMemo(() => {
    if (notification.type !== "BADGE_RECEIVED") return null;
    return badges.find((b) => b.name === notification.variables.badgeName);
  }, [notification, badges]);

  const handleClick = useCallback(() => {
    if (!notification.isRead) {
      onMarkAsRead(notification.id);
    }

    if (notification.url) {
      navigate(parseNotificationUrl(notification.url));
    }
  }, [notification, onMarkAsRead, navigate]);

  const handleAccept = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const senderId = notification.variables.senderId;
      if (senderId) {
        await updateFriendRequestState(senderId, "ACCEPTED");
        onAcceptFriendRequest?.(senderId);
        onDismiss(notification.id);
      }
    },
    [notification, updateFriendRequestState, onAcceptFriendRequest, onDismiss]
  );

  const handleRefuse = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const senderId = notification.variables.senderId;
      if (senderId) {
        await updateFriendRequestState(senderId, "REFUSED");
        onRefuseFriendRequest?.(senderId);
        onDismiss(notification.id);
      }
    },
    [notification, updateFriendRequestState, onRefuseFriendRequest, onDismiss]
  );

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(notification.id);
    },
    [notification.id, onDismiss]
  );

  const getNotificationContent = () => {
    switch (notification.type) {
      case "FRIEND_REQUEST_RECEIVED":
        return {
          title: t("friend_request_received_title"),
          description: t("friend_request_received_description", {
            displayName: notification.variables.senderDisplayName,
          }),
          showActions: true,
        };
      case "FRIEND_REQUEST_ACCEPTED":
        return {
          title: t("friend_request_accepted_title"),
          description: t("friend_request_accepted_description", {
            displayName: notification.variables.accepterDisplayName,
          }),
          showActions: false,
        };
      case "BADGE_RECEIVED":
        return {
          title: t("badge_received_title"),
          description: badge?.description || notification.variables.badgeName,
          showActions: false,
        };
      case "REVIEW_UPVOTE":
        return {
          title: t("review_upvote_title", {
            gameTitle: notification.variables.gameTitle,
          }),
          description: t("review_upvote_description", {
            count: Number.parseInt(
              notification.variables.upvoteCount || "1",
              10
            ),
          }),
          showActions: false,
        };
      default:
        return {
          title: t("notification"),
          description: "",
          showActions: false,
        };
    }
  };

  const content = getNotificationContent();
  const isBadge = notification.type === "BADGE_RECEIVED";
  const isReview = notification.type === "REVIEW_UPVOTE";

  const getIcon = () => {
    if (notification.pictureUrl) {
      return <img src={notification.pictureUrl} alt="" />;
    }
    if (isReview) {
      return <StarFillIcon size={24} />;
    }
    return <PersonIcon size={24} />;
  };

  return (
    <button
      type="button"
      className={cn("notification-item", {
        "notification-item--unread":
          !notification.isRead ||
          notification.type === "FRIEND_REQUEST_RECEIVED",
      })}
      onClick={handleClick}
    >
      <div
        className={cn("notification-item__picture", {
          "notification-item__badge-picture": isBadge,
          "notification-item__review-picture": isReview,
        })}
      >
        {getIcon()}
      </div>

      <div className="notification-item__content">
        <span className="notification-item__title">{content.title}</span>
        <span className="notification-item__description">
          {content.description}
        </span>
        <span className="notification-item__time">
          <ClockIcon size={12} />
          {formatDistance(new Date(notification.createdAt), new Date())}
        </span>
      </div>

      {content.showActions &&
        notification.type === "FRIEND_REQUEST_RECEIVED" && (
          <div className="notification-item__actions">
            <Button theme="primary" onClick={handleAccept}>
              {t("accept")}
            </Button>
            <Button theme="outline" onClick={handleRefuse}>
              {t("refuse")}
            </Button>
          </div>
        )}

      {notification.type !== "FRIEND_REQUEST_RECEIVED" && (
        <button
          type="button"
          className="notification-item__dismiss"
          onClick={handleDismiss}
          title={t("dismiss")}
        >
          <XIcon size={16} />
        </button>
      )}
    </button>
  );
}
