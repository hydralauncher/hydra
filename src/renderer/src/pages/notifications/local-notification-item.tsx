import { useCallback } from "react";
import { CloseSquare, Import, Box, Refresh, Cup, Clock } from "iconsax-reactjs";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useDate } from "@renderer/hooks";
import cn from "classnames";

import type { LocalNotification } from "@types";
import "./notification-item.scss";

interface LocalNotificationItemProps {
  notification: LocalNotification;
  onDismiss: (id: string) => void;
  onMarkAsRead: (id: string) => void;
}

export function LocalNotificationItem({
  notification,
  onDismiss,
  onMarkAsRead,
}: Readonly<LocalNotificationItemProps>) {
  const { t } = useTranslation("notifications_page");
  const { formatDistance } = useDate();
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    if (!notification.isRead) {
      onMarkAsRead(notification.id);
    }

    if (notification.url) {
      navigate(notification.url);
    }
  }, [notification, onMarkAsRead, navigate]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDismiss(notification.id);
    },
    [notification.id, onDismiss]
  );

  const getIcon = () => {
    switch (notification.type) {
      case "DOWNLOAD_COMPLETE":
        return <Import size={24} variant="Linear" />;
      case "EXTRACTION_COMPLETE":
        return <Box size={24} variant="Linear" />;
      case "UPDATE_AVAILABLE":
        return <Refresh size={24} variant="Linear" />;
      case "ACHIEVEMENT_UNLOCKED":
        return <Cup size={24} variant="Linear" />;
      case "SCAN_GAMES_COMPLETE":
        return <Refresh size={24} variant="Linear" />;
      default:
        return <Import size={24} variant="Linear" />;
    }
  };

  return (
    <button
      type="button"
      className={cn("notification-item", {
        "notification-item--unread": !notification.isRead,
      })}
      onClick={handleClick}
    >
      <div className="notification-item__picture">
        {notification.pictureUrl ? (
          <img src={notification.pictureUrl} alt="" />
        ) : (
          getIcon()
        )}
      </div>

      <div className="notification-item__content">
        <span className="notification-item__title">{notification.title}</span>
        <span className="notification-item__description">
          {notification.description}
        </span>
        <span className="notification-item__time">
          <Clock size={12} variant="Linear" />
          {formatDistance(new Date(notification.createdAt), new Date())}
        </span>
      </div>

      <button
        type="button"
        className="notification-item__dismiss"
        onClick={handleDismiss}
        title={t("dismiss")}
      >
        <CloseSquare size={16} variant="Linear" />
      </button>
    </button>
  );
}
