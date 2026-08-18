import { useEffect, useRef } from "react";
import { BellIcon, XIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import { useState, useCallback, useMemo } from "react";
import { NotificationItem } from "@renderer/pages/notifications/notification-item";
import { LocalNotificationItem } from "@renderer/pages/notifications/local-notification-item";
import { useGamepadConnected } from "@renderer/hooks/use-gamepad";
import type {
  Notification,
  LocalNotification,
  NotificationsResponse,
  MergedNotification,
  Badge,
} from "@types";
import "./notifications-sidebar.scss";

type NotificationFilter = "all" | "unread";

const STAGGER_DELAY_MS = 70;
const EXIT_DURATION_MS = 250;

interface NotificationsSidebarProps {
  open: boolean;
  onClose: () => void;
}

export function NotificationsSidebar({
  open,
  onClose,
}: Readonly<NotificationsSidebarProps>) {
  const { t, i18n } = useTranslation("notifications_page");
  const { showSuccessToast, showErrorToast } = useToast();
  const { userDetails } = useUserDetails();
  const isGamepadConnected = useGamepadConnected();

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
      const res = await window.electron.hydraApi.get<Badge[]>(
        `/badges?${params}`,
        { needsAuth: false }
      );
      setBadges(res);
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

  const fetchAll = useCallback(
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
    if (open) fetchAll(filter);
  }, [open, fetchAll, filter]);

  useEffect(() => {
    const unsub = window.electron.onLocalNotificationCreated((n) => {
      setLocalNotifications((prev) => [n, ...prev]);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (open && isGamepadConnected) {
      setTimeout(() => {
        const defaultFocus = document.querySelector(
          ".notifications-sidebar__close-btn"
        ) as HTMLElement;
        if (defaultFocus) defaultFocus.focus({ preventScroll: false });
      }, 50);
    }
  }, [open, isGamepadConnected]);

  useEffect(
    () => () => {
      clearingTimeoutsRef.current.forEach(clearTimeout);
    },
    []
  );

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const mergedNotifications = useMemo<MergedNotification[]>(() => {
    const sortByDate = (a: MergedNotification, b: MergedNotification) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    const highPriority: MergedNotification[] = apiNotifications
      .filter((n) => n.priority === 1)
      .map((n) => ({ ...n, source: "api" as const }));
    const lowPriorityApi: MergedNotification[] = apiNotifications
      .filter((n) => n.priority !== 1)
      .map((n) => ({ ...n, source: "api" as const }));
    const filteredLocal =
      filter === "unread"
        ? localNotifications.filter((n) => !n.isRead)
        : localNotifications;
    const localWithSource: MergedNotification[] = filteredLocal.map((n) => ({
      ...n,
      source: "local" as const,
    }));
    return [
      ...highPriority,
      ...[...lowPriorityApi, ...localWithSource].sort(sortByDate),
    ];
  }, [apiNotifications, localNotifications, filter]);

  const unreadCount = useMemo(() => {
    return (
      apiNotifications.filter((n) => !n.isRead).length +
      localNotifications.filter((n) => !n.isRead).length
    );
  }, [apiNotifications, localNotifications]);

  const notifyCountChange = useCallback(
    () => window.dispatchEvent(new CustomEvent("notificationsChanged")),
    []
  );

  const handleMarkAsRead = useCallback(
    async (id: string, source: "api" | "local") => {
      try {
        if (source === "api") {
          await window.electron.hydraApi.patch(
            `/profile/notifications/${id}/read`,
            { data: { id }, needsAuth: true }
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
        logger.error("Failed to mark as read", error);
      }
    },
    [notifyCountChange]
  );

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      if (userDetails && apiNotifications.some((n) => !n.isRead)) {
        await window.electron.hydraApi.patch(
          "/profile/notifications/all/read",
          { needsAuth: true }
        );
        setApiNotifications((prev) =>
          prev.map((n) => ({ ...n, isRead: true }))
        );
      }
      await window.electron.markAllLocalNotificationsRead();
      setLocalNotifications((prev) =>
        prev.map((n) => ({ ...n, isRead: true }))
      );
      notifyCountChange();
      showSuccessToast(t("marked_all_as_read"));
    } catch (error) {
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
        showErrorToast(t("failed_to_dismiss"));
      }
    },
    [showErrorToast, t, notifyCountChange]
  );

  const handleClearAll = useCallback(async () => {
    if (isClearing) return;
    try {
      setIsClearing(true);
      clearingTimeoutsRef.current.forEach(clearTimeout);
      clearingTimeoutsRef.current = [];
      const toRemove = [...mergedNotifications];
      await Promise.all(
        toRemove.map((n, i) =>
          removeNotificationWithDelay(n, i * STAGGER_DELAY_MS)
        )
      );
      await new Promise((resolve) => setTimeout(resolve, EXIT_DURATION_MS));
      if (userDetails)
        await window.electron.hydraApi.delete("/profile/notifications/all", {
          needsAuth: true,
        });
      await window.electron.clearAllLocalNotifications();
      setPagination({ total: 0, hasMore: false, skip: 0 });
      notifyCountChange();
      showSuccessToast(t("cleared_all"));
    } catch (error) {
      showErrorToast(t("failed_to_clear"));
    } finally {
      setIsClearing(false);
      clearingTimeoutsRef.current = [];
    }
  }, [
    isClearing,
    mergedNotifications,
    removeNotificationWithDelay,
    userDetails,
    showSuccessToast,
    showErrorToast,
    t,
    notifyCountChange,
  ]);

  const handleLoadMore = useCallback(() => {
    if (pagination.hasMore && !isLoading)
      fetchApiNotifications(pagination.skip, true, filter);
  }, [pagination, isLoading, fetchApiNotifications, filter]);

  const handleAcceptFriendRequest = useCallback(
    () => showSuccessToast(t("friend_request_accepted")),
    [showSuccessToast, t]
  );
  const handleRefuseFriendRequest = useCallback(
    () => showSuccessToast(t("friend_request_refused")),
    [showSuccessToast, t]
  );

  const hasNoNotifications = mergedNotifications.length === 0;
  const shouldDisableActions = isClearing || hasNoNotifications;

  return (
    <>
      {/* Click-outside backdrop */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="notifications-sidebar__backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      {/* Sidebar panel */}
      <div
        className={`notifications-sidebar-wrapper${open ? " notifications-sidebar-wrapper--open" : ""}`}
        data-gamepad-ignore={!open ? "true" : undefined}
      >
        <div className="notifications-sidebar">
          {/* Header */}
          <div className="notifications-sidebar__header">
            <div className="notifications-sidebar__title">
              <BellIcon size={16} />
              <span>{t("title")}</span>
              {unreadCount > 0 && (
                <span className="notifications-sidebar__badge">
                  {unreadCount}
                </span>
              )}
            </div>
            <button
              type="button"
              className="notifications-sidebar__close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* Filter tabs */}
          <div className="notifications-sidebar__tabs">
            <button
              type="button"
              className={`notifications-sidebar__tab${filter === "all" ? " notifications-sidebar__tab--active" : ""}`}
              onClick={() => setFilter("all")}
            >
              {t("filter_all")}
            </button>
            <button
              type="button"
              className={`notifications-sidebar__tab${filter === "unread" ? " notifications-sidebar__tab--active" : ""}`}
              onClick={() => setFilter("unread")}
            >
              {t("filter_unread")}
              {unreadCount > 0 && (
                <span className="notifications-sidebar__tab-badge">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>

          {/* Actions */}
          <div className="notifications-sidebar__actions">
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

          {/* Content */}
          <div className="notifications-sidebar__content">
            {isInitialLoad && isLoading ? (
              <div className="notifications-sidebar__loading">
                <span>{t("loading")}</span>
              </div>
            ) : hasNoNotifications && !isClearing ? (
              <div className="notifications-sidebar__empty">
                <BellIcon size={24} />
                <p>
                  {filter === "unread"
                    ? t("empty_filter_description")
                    : t("empty_description")}
                </p>
              </div>
            ) : (
              <div className="notifications-sidebar__list">
                <AnimatePresence>
                  {mergedNotifications.map((notification) => {
                    const key =
                      notification.source === "local"
                        ? `local-${notification.id}`
                        : `api-${notification.id}`;
                    return (
                      <motion.div
                        key={key}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{
                          opacity: 0,
                          x: 60,
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
                  })}
                </AnimatePresence>

                {pagination.hasMore && !isClearing && (
                  <div className="notifications-sidebar__load-more">
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
            )}
          </div>
        </div>
      </div>
    </>
  );
}
