import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type NotificationFilter = "all" | "unread";

const STAGGER_DELAY_MS = 70;
const EXIT_DURATION_MS = 250;

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
  const [isClearing, setIsClearing] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [pagination, setPagination] = useState({
    total: 0,
    hasMore: false,
    skip: 0,
  });
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const clearingTimeoutsRef = useRef<NodeJS.Timeout[]>([]);

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
    async (
      skip = 0,
      append = false,
      filterParam: NotificationFilter = "all"
    ) => {
      if (!userDetails) return;

      try {
        setIsLoading(true);
        const response =
          await window.electron.hydraApi.get<NotificationsResponse>(
            "/profile/notifications",
            {
              params: { filter: filterParam, take: 20, skip },
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

  const fetchAllNotifications = useCallback(
    async (filterParam: NotificationFilter = "all") => {
      setIsLoading(true);
      await Promise.all([
        fetchLocalNotifications(),
        fetchBadges(),
        userDetails
          ? fetchApiNotifications(0, false, filterParam)
          : Promise.resolve(),
      ]);
      setIsLoading(false);
      setIsInitialLoad(false);
    },
    [fetchLocalNotifications, fetchBadges, fetchApiNotifications, userDetails]
  );

  useEffect(() => {
    fetchAllNotifications(filter);
  }, [fetchAllNotifications, filter]);

  useEffect(() => {
    const unsubscribe = window.electron.onLocalNotificationCreated(
      (notification) => {
        setLocalNotifications((prev) => [notification, ...prev]);
      }
    );

    return () => unsubscribe();
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      clearingTimeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

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

    // Filter local notifications based on current filter
    const filteredLocalNotifications =
      filter === "unread"
        ? localNotifications.filter((n) => !n.isRead)
        : localNotifications;

    const localWithSource: MergedNotification[] =
      filteredLocalNotifications.map((n) => ({
        ...n,
        source: "local" as const,
      }));

    const lowPriority = [...lowPriorityApi, ...localWithSource].sort(
      sortByDate
    );

    return [...highPriority, ...lowPriority];
  }, [apiNotifications, localNotifications, filter]);

  const displayedNotifications = useMemo(() => {
    return mergedNotifications;
  }, [mergedNotifications]);

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

  const removeNotificationFromState = useCallback(
    (notification: MergedNotification) => {
      if (notification.source === "api") {
        setApiNotifications((prev) =>
          prev.filter((n) => n.id !== notification.id)
        );
      } else {
        setLocalNotifications((prev) =>
          prev.filter((n) => n.id !== notification.id)
        );
      }
    },
    []
  );

  const removeNotificationWithDelay = useCallback(
    (notification: MergedNotification, delayMs: number): Promise<void> => {
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          removeNotificationFromState(notification);
          resolve();
        }, delayMs);

        clearingTimeoutsRef.current.push(timeout);
      });
    },
    [removeNotificationFromState]
  );

  const handleClearAll = useCallback(async () => {
    if (isClearing) return;

    try {
      setIsClearing(true);

      // Clear any existing timeouts
      clearingTimeoutsRef.current.forEach(clearTimeout);
      clearingTimeoutsRef.current = [];

      // Snapshot current notifications for staggered removal
      const notificationsToRemove = [...displayedNotifications];
      const totalNotifications = notificationsToRemove.length;

      if (totalNotifications === 0) {
        setIsClearing(false);
        return;
      }

      // Remove items one by one with staggered delays for visual effect
      const removalPromises = notificationsToRemove.map((notification, index) =>
        removeNotificationWithDelay(notification, index * STAGGER_DELAY_MS)
      );

      // Wait for all items to be removed from state
      await Promise.all(removalPromises);

      // Wait for the last exit animation to complete
      await new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS));

      // Perform actual backend deletions (state is already cleared by staggered removal)
      if (userDetails) {
        await window.electron.hydraApi.delete(`/profile/notifications/all`, {
          needsAuth: true,
        });
      }
      await window.electron.clearAllLocalNotifications();
      setPagination({ total: 0, hasMore: false, skip: 0 });
      notifyCountChange();
      showSuccessToast(t("cleared_all"));
    } catch (error) {
      logger.error("Failed to clear all notifications", error);
      showErrorToast(t("failed_to_clear"));
    } finally {
      setIsClearing(false);
      clearingTimeoutsRef.current = [];
    }
  }, [
    displayedNotifications,
    isClearing,
    removeNotificationWithDelay,
    userDetails,
    showSuccessToast,
    showErrorToast,
    t,
    notifyCountChange,
  ]);

  const handleLoadMore = useCallback(() => {
    if (pagination.hasMore && !isLoading) {
      fetchApiNotifications(pagination.skip, true, filter);
    }
  }, [pagination, isLoading, fetchApiNotifications, filter]);

  const handleFilterChange = useCallback(
    (newFilter: NotificationFilter) => {
      if (newFilter !== filter) {
        setFilter(newFilter);
        setPagination({ total: 0, hasMore: false, skip: 0 });
      }
    },
    [filter]
  );

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
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{
          opacity: 0,
          x: 80,
          transition: { duration: EXIT_DURATION_MS / 1000 },
        }}
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

  const unreadCount = useMemo(() => {
    const apiUnread = apiNotifications.filter((n) => !n.isRead).length;
    const localUnread = localNotifications.filter((n) => !n.isRead).length;
    return apiUnread + localUnread;
  }, [apiNotifications, localNotifications]);

  const renderFilterTabs = () => (
    <div className="notifications__filter-tabs">
      <div className="notifications__tab-wrapper">
        <button
          type="button"
          className={`notifications__tab ${filter === "all" ? "notifications__tab--active" : ""}`}
          onClick={() => handleFilterChange("all")}
        >
          {t("filter_all")}
        </button>
        {filter === "all" && (
          <motion.div
            className="notifications__tab-underline"
            layoutId="notifications-tab-underline"
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        )}
      </div>
      <div className="notifications__tab-wrapper">
        <button
          type="button"
          className={`notifications__tab ${filter === "unread" ? "notifications__tab--active" : ""}`}
          onClick={() => handleFilterChange("unread")}
        >
          {t("filter_unread")}
          {unreadCount > 0 && (
            <span className="notifications__tab-badge">{unreadCount}</span>
          )}
        </button>
        {filter === "unread" && (
          <motion.div
            className="notifications__tab-underline"
            layoutId="notifications-tab-underline"
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          />
        )}
      </div>
    </div>
  );

  const hasNoNotifications = mergedNotifications.length === 0;
  const shouldDisableActions = isClearing || hasNoNotifications;

  const renderContent = () => {
    if (isInitialLoad && isLoading) {
      return (
        <div className="notifications__loading">
          <span>{t("loading")}</span>
        </div>
      );
    }

    return (
      <div className="notifications">
        <div className="notifications__header">
          {renderFilterTabs()}
          <div className="notifications__actions">
            <Button
              theme="outline"
              onClick={handleMarkAllAsRead}
              disabled={shouldDisableActions}
            >
              {t("mark_all_as_read")}
            </Button>
            <Button
              theme="danger"
              onClick={handleClearAll}
              disabled={shouldDisableActions}
            >
              {t("clear_all")}
            </Button>
          </div>
        </div>

        {/* Keep AnimatePresence mounted during clearing to preserve exit animations */}
        <AnimatePresence mode="wait">
          <motion.div
            key={filter}
            className="notifications__content-wrapper"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2 }}
          >
            {hasNoNotifications && !isClearing ? (
              <div className="notifications__empty">
                <div className="notifications__icon-container">
                  <BellIcon size={24} />
                </div>
                <h2>{t("empty_title")}</h2>
                <p>
                  {filter === "unread"
                    ? t("empty_filter_description")
                    : t("empty_description")}
                </p>
              </div>
            ) : (
              <div className="notifications__list">
                <AnimatePresence>
                  {displayedNotifications.map(renderNotification)}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {pagination.hasMore && !isClearing && (
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
