import { useCallback, useEffect, useMemo, useState } from "react";
import { BellIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@renderer/components";
import { useAppDispatch, useToast, useUserDetails } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { logger } from "@renderer/logger";

import { NotificationItem } from "./notification-item";
import { LocalNotificationItem } from "./local-notification-item";
import type {
  Notification,
  LocalNotification,
  NotificationsResponse,
  MergedNotification,
  Badge,
} from "@types";
import "./notifications.scss";

export default function Notifications() {
  const { t, i18n } = useTranslation("notifications_page");
  const { showSuccessToast, showErrorToast } = useToast();
  const { userDetails } = useUserDetails();
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(setHeaderTitle(t("title")));
  }, [dispatch, t]);

  const [apiNotifications, setApiNotifications] = useState<Notification[]>([]);
  const [localNotifications, setLocalNotifications] = useState<
    LocalNotification[]
  >([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [clearingIds, setClearingIds] = useState<Set<string>>(new Set());
  const [pagination, setPagination] = useState({
    total: 0,
    hasMore: false,
    skip: 0,
  });

  const fetchLocalNotifications = useCallback(async () => {
    try {
      const notifications = await window.electron.getLocalNotifications();
      setLocalNotifications(notifications);
    } catch (error) {
      logger.error("Failed to fetch local notifications", error);
    }
  }, []);

  const fetchBadges = useCallback(async () => {
    try {
      const language = i18n.language.split("-")[0];
      const params = new URLSearchParams({ locale: language });
      const badgesResponse = await window.electron.hydraApi.get<Badge[]>(
        `/badges?${params.toString()}`,
        { needsAuth: false }
      );
      setBadges(badgesResponse);
    } catch (error) {
      logger.error("Failed to fetch badges", error);
    }
  }, [i18n.language]);

  const fetchApiNotifications = useCallback(
    async (skip = 0, append = false) => {
      if (!userDetails) return;

      try {
        setIsLoading(true);
        const response =
          await window.electron.hydraApi.get<NotificationsResponse>(
            "/profile/notifications",
            {
              params: { filter: "all", take: 20, skip },
              needsAuth: true,
            }
          );

        logger.log("Notifications API response:", response);

        if (append) {
          setApiNotifications((prev) => [...prev, ...response.notifications]);
        } else {
          setApiNotifications(response.notifications);
        }

        setPagination({
          total: response.pagination.total,
          hasMore: response.pagination.hasMore,
          skip: response.pagination.skip + response.pagination.take,
        });
      } catch (error) {
        logger.error("Failed to fetch API notifications", error);
      } finally {
        setIsLoading(false);
      }
    },
    [userDetails]
  );

  const fetchAllNotifications = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([
      fetchLocalNotifications(),
      fetchBadges(),
      userDetails ? fetchApiNotifications(0, false) : Promise.resolve(),
    ]);
    setIsLoading(false);
  }, [
    fetchLocalNotifications,
    fetchBadges,
    fetchApiNotifications,
    userDetails,
  ]);

  useEffect(() => {
    fetchAllNotifications();
  }, [fetchAllNotifications]);

  useEffect(() => {
    const unsubscribe = window.electron.onLocalNotificationCreated(
      (notification) => {
        setLocalNotifications((prev) => [notification, ...prev]);
      }
    );

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = window.electron.onSyncNotificationCount(() => {
      if (userDetails) {
        fetchApiNotifications(0, false);
      }
      fetchLocalNotifications();
    });

    return () => unsubscribe();
  }, [userDetails, fetchApiNotifications, fetchLocalNotifications]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && userDetails) {
        fetchApiNotifications(0, false);
        fetchLocalNotifications();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [userDetails, fetchApiNotifications, fetchLocalNotifications]);

  const mergedNotifications = useMemo<MergedNotification[]>(() => {
    const sortByDate = (a: MergedNotification, b: MergedNotification) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

    // High priority notifications (priority === 1) - keep in API order
    const highPriority: MergedNotification[] = apiNotifications
      .filter((n) => n.priority === 1)
      .map((n) => ({ ...n, source: "api" as const }));

    // Low priority: other API notifications + local notifications, merged and sorted by date
    const lowPriorityApi: MergedNotification[] = apiNotifications
      .filter((n) => n.priority !== 1)
      .map((n) => ({ ...n, source: "api" as const }));

    const localWithSource: MergedNotification[] = localNotifications.map(
      (n) => ({
        ...n,
        source: "local" as const,
      })
    );

    const lowPriority = [...lowPriorityApi, ...localWithSource].sort(
      sortByDate
    );

    return [...highPriority, ...lowPriority];
  }, [apiNotifications, localNotifications]);

  const displayedNotifications = useMemo(() => {
    return mergedNotifications.filter((n) => !clearingIds.has(n.id));
  }, [mergedNotifications, clearingIds]);

  const notifyCountChange = useCallback(() => {
    window.dispatchEvent(new CustomEvent("notificationsChanged"));
  }, []);

  const handleMarkAsRead = useCallback(
    async (id: string, source: "api" | "local") => {
      try {
        if (source === "api") {
          await window.electron.hydraApi.patch(
            `/profile/notifications/${id}/read`,
            {
              data: { id },
              needsAuth: true,
            }
          );
          setApiNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
          );
        } else {
          await window.electron.markLocalNotificationRead(id);
          setLocalNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
          );
        }
        notifyCountChange();
      } catch (error) {
        logger.error("Failed to mark notification as read", error);
      }
    },
    [notifyCountChange]
  );

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      // Mark all API notifications as read
      if (userDetails && apiNotifications.some((n) => !n.isRead)) {
        await window.electron.hydraApi.patch(
          `/profile/notifications/all/read`,
          { needsAuth: true }
        );
        setApiNotifications((prev) =>
          prev.map((n) => ({ ...n, isRead: true }))
        );
      }

      // Mark all local notifications as read
      await window.electron.markAllLocalNotificationsRead();
      setLocalNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true }))
      );

      notifyCountChange();
      showSuccessToast(t("marked_all_as_read"));
    } catch (error) {
      logger.error("Failed to mark all as read", error);
      showErrorToast(t("failed_to_mark_as_read"));
    }
  }, [
    apiNotifications,
    userDetails,
    showSuccessToast,
    showErrorToast,
    t,
    notifyCountChange,
  ]);

  const handleDismiss = useCallback(
    async (id: string, source: "api" | "local") => {
      try {
        if (source === "api") {
          await window.electron.hydraApi.delete(
            `/profile/notifications/${id}`,
            { needsAuth: true }
          );
          setApiNotifications((prev) => prev.filter((n) => n.id !== id));
          setPagination((prev) => ({ ...prev, total: prev.total - 1 }));
        } else {
          await window.electron.deleteLocalNotification(id);
          setLocalNotifications((prev) => prev.filter((n) => n.id !== id));
        }
        notifyCountChange();
      } catch (error) {
        logger.error("Failed to dismiss notification", error);
        showErrorToast(t("failed_to_dismiss"));
      }
    },
    [showErrorToast, t, notifyCountChange]
  );

  const handleClearAll = useCallback(async () => {
    try {
      // Mark all as clearing for animation
      const allIds = new Set([
        ...apiNotifications.map((n) => n.id),
        ...localNotifications.map((n) => n.id),
      ]);
      setClearingIds(allIds);

      // Wait for exit animation
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Clear all API notifications
      if (userDetails && apiNotifications.length > 0) {
        await window.electron.hydraApi.delete(`/profile/notifications/all`, {
          needsAuth: true,
        });
        setApiNotifications([]);
      }

      // Clear all local notifications
      await window.electron.clearAllLocalNotifications();
      setLocalNotifications([]);

      setClearingIds(new Set());
      setPagination({ total: 0, hasMore: false, skip: 0 });
      notifyCountChange();
      showSuccessToast(t("cleared_all"));
    } catch (error) {
      logger.error("Failed to clear all notifications", error);
      setClearingIds(new Set());
      showErrorToast(t("failed_to_clear"));
    }
  }, [
    apiNotifications,
    localNotifications,
    userDetails,
    showSuccessToast,
    showErrorToast,
    t,
    notifyCountChange,
  ]);

  const handleLoadMore = useCallback(() => {
    if (pagination.hasMore && !isLoading) {
      fetchApiNotifications(pagination.skip, true);
    }
  }, [pagination, isLoading, fetchApiNotifications]);

  const handleAcceptFriendRequest = useCallback(() => {
    showSuccessToast(t("friend_request_accepted"));
  }, [showSuccessToast, t]);

  const handleRefuseFriendRequest = useCallback(() => {
    showSuccessToast(t("friend_request_refused"));
  }, [showSuccessToast, t]);

  const renderNotification = (notification: MergedNotification) => {
    const key =
      notification.source === "local"
        ? `local-${notification.id}`
        : `api-${notification.id}`;

    return (
      <motion.div
        key={key}
        layout
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 100, transition: { duration: 0.2 } }}
        transition={{ duration: 0.2 }}
      >
        {notification.source === "local" ? (
          <LocalNotificationItem
            notification={notification}
            onDismiss={(id) => handleDismiss(id, "local")}
            onMarkAsRead={(id) => handleMarkAsRead(id, "local")}
          />
        ) : (
          <NotificationItem
            notification={notification}
            badges={badges}
            onDismiss={(id) => handleDismiss(id, "api")}
            onMarkAsRead={(id) => handleMarkAsRead(id, "api")}
            onAcceptFriendRequest={handleAcceptFriendRequest}
            onRefuseFriendRequest={handleRefuseFriendRequest}
          />
        )}
      </motion.div>
    );
  };

  const renderContent = () => {
    if (isLoading && mergedNotifications.length === 0) {
      return (
        <div className="notifications__loading">
          <span>{t("loading")}</span>
        </div>
      );
    }

    if (mergedNotifications.length === 0) {
      return (
        <div className="notifications__empty">
          <div className="notifications__icon-container">
            <BellIcon size={24} />
          </div>
          <h2>{t("empty_title")}</h2>
          <p>{t("empty_description")}</p>
        </div>
      );
    }

    return (
      <div className="notifications">
        <div className="notifications__actions">
          <Button theme="outline" onClick={handleMarkAllAsRead}>
            {t("mark_all_as_read")}
          </Button>
          <Button theme="danger" onClick={handleClearAll}>
            {t("clear_all")}
          </Button>
        </div>

        <div className="notifications__list">
          <AnimatePresence mode="popLayout">
            {displayedNotifications.map(renderNotification)}
          </AnimatePresence>
        </div>

        {pagination.hasMore && (
          <div className="notifications__load-more">
            <Button
              theme="outline"
              onClick={handleLoadMore}
              disabled={isLoading}
            >
              {isLoading ? t("loading") : t("load_more")}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return <>{renderContent()}</>;
}
