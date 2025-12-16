import { useCallback } from "react";
import {
  XIcon,
  DownloadIcon,
  PackageIcon,
  SyncIcon,
  TrophyIcon,
  ClockIcon,
} from "@primer/octicons-react";
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
}: LocalNotificationItemProps) {
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
        return <DownloadIcon size={24} />;
      case "EXTRACTION_COMPLETE":
        return <PackageIcon size={24} />;
      case "UPDATE_AVAILABLE":
        return <SyncIcon size={24} />;
      case "ACHIEVEMENT_UNLOCKED":
        return <TrophyIcon size={24} />;
      default:
        return <DownloadIcon size={24} />;
    }
  };

  return (
    <div
      className={cn("notification-item", {
        "notification-item--unread": !notification.isRead,
      })}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick();
        }
      }}
      role="button"
      tabIndex={0}
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
          <ClockIcon size={12} />
          {formatDistance(new Date(notification.createdAt), new Date())}
        </span>
      </div>

      <button
        type="button"
        className="notification-item__dismiss"
        onClick={handleDismiss}
        title={t("dismiss")}
      >
        <XIcon size={16} />
      </button>
    </div>
  );
}
