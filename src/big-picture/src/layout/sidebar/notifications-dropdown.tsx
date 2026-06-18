import "./notifications-dropdown.scss";

import {
  CheckCircleIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  MinusCircleIcon,
  TrashIcon,
  TrophyIcon,
  UserCheckIcon,
  UserMinusIcon,
  XIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { createPortal } from "react-dom";
import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  ContextMenu,
  FocusItem,
  NavigationLayer,
  type ContextMenuItem,
  ScrollArea,
  VerticalFocusGroup,
} from "../../components";
import { FocusRegionContext } from "../../components/context";
import { IS_DESKTOP } from "../../constants";
import {
  useDate,
  useLibrary,
  useNavigationActions,
  useNavigationScreenActions,
} from "../../hooks";
import { getPreferredGameAssets } from "../../helpers";
import type {
  FriendRequestAction,
  LibraryGame,
  LocalNotification,
  MergedNotification,
  Notification,
  NotificationCountResponse,
  NotificationsResponse,
} from "@types";

const hydraIconUrl = new URL("../../assets/hydra-icon.svg", import.meta.url)
  .href;
const DROPDOWN_OFFSET = 16;
const DROPDOWN_REGION_ID = "sidebar-notifications-dropdown-region";

interface SidebarNotificationsDropdownProps {
  anchorRef: RefObject<HTMLButtonElement>;
  visible: boolean;
  onClose: () => void;
  onRestoringFocusChange: (isRestoring: boolean) => void;
  onUnreadCountChange: (count: number) => void;
  restoreFocusId: string;
}

interface SidebarNotificationsBackActionProps {
  onBack: () => void;
}

function SidebarNotificationsBackAction({
  onBack,
}: Readonly<SidebarNotificationsBackActionProps>) {
  useNavigationScreenActions({
    press: {
      b: onBack,
    },
  });

  return null;
}

function parseApiNotificationPath(notificationUrl: string) {
  const url = new URL(notificationUrl, "http://localhost");
  const userId = url.searchParams.get("userId");
  const gameTitle = url.searchParams.get("title");
  const showReviews = url.searchParams.get("reviews");

  if (url.pathname === "/profile" && userId) {
    return `/profile/${userId}`;
  }

  if (url.pathname.startsWith("/game/")) {
    const params = new URLSearchParams();
    if (gameTitle) params.set("title", gameTitle);
    if (showReviews) params.set("reviews", showReviews);
    const queryString = params.toString();
    return queryString ? `${url.pathname}?${queryString}` : url.pathname;
  }

  return notificationUrl;
}

function resolveBigPicturePath(path: string) {
  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(path)) return path;
  if (path.startsWith("/big-picture")) return path;
  return `/big-picture${path}`;
}

function getApiNotificationContent(notification: Notification) {
  switch (notification.type) {
    case "FRIEND_REQUEST_RECEIVED":
      return {
        title: "New friend request",
        description: `${notification.variables.senderDisplayName ?? "Someone"} has sent you a friend request!`,
      };
    case "FRIEND_REQUEST_ACCEPTED":
      return {
        title: "Friend request accepted",
        description: `${notification.variables.accepterDisplayName ?? "Someone"} accepted your friend request.`,
      };
    case "BADGE_RECEIVED":
      return {
        title: "New badge received",
        description: notification.variables.badgeName ?? "",
      };
    case "REVIEW_UPVOTE":
      return {
        title: `${notification.variables.gameTitle ?? "Your review"} got an upvote`,
        description: `${notification.variables.upvoteCount ?? "1"} upvotes on your review.`,
      };
    case "REVIEW_ANSWER":
      return {
        title: `New reply to your review for ${notification.variables.gameTitle ?? "your review"}`,
        description: `${notification.variables.answerAuthorDisplayName ?? "Someone"} replied to your review.`,
      };
    case "REVIEW_ANSWER_UPVOTE":
      return {
        title: `Your reply for ${notification.variables.gameTitle ?? "a review"} got an upvote`,
        description: `${notification.variables.upvoteCount ?? "1"} upvotes on your reply.`,
      };
    default:
      return {
        title: "Notification",
        description: "",
      };
  }
}

function getNotificationContent(notification: MergedNotification) {
  if (notification.source === "local") {
    return {
      title: notification.title,
      description: notification.description,
    };
  }

  return getApiNotificationContent(notification);
}

function isHydraNotification(notification: MergedNotification) {
  return (
    notification.source === "local" &&
    (notification.type === "UPDATE_AVAILABLE" ||
      notification.type === "SCAN_GAMES_COMPLETE")
  );
}

function isAchievementNotification(notification: MergedNotification) {
  return (
    notification.source === "local" &&
    notification.type === "ACHIEVEMENT_UNLOCKED"
  );
}

function getNotificationUrl(notification: MergedNotification) {
  if (!notification.url) return null;
  return notification.source === "api"
    ? parseApiNotificationPath(notification.url)
    : notification.url;
}

function getNotificationGameRoute(notification: MergedNotification) {
  const url = getNotificationUrl(notification);
  if (!url) return null;

  const pathname = url.startsWith("/big-picture")
    ? url.slice("/big-picture".length) || "/"
    : url;
  const match = pathname.match(/^\/game\/([^/?#]+)\/([^/?#]+)/);
  if (!match) return null;

  return {
    shop: decodeURIComponent(match[1]),
    objectId: decodeURIComponent(match[2]),
  };
}

function getGameImageUrlFromLibrary(
  notification: MergedNotification,
  library: LibraryGame[]
) {
  if (notification.pictureUrl) return notification.pictureUrl;

  const gameRoute = getNotificationGameRoute(notification);
  if (!gameRoute) return null;

  const game = library.find(
    (libraryGame) =>
      libraryGame.shop === gameRoute.shop &&
      libraryGame.objectId === gameRoute.objectId
  );

  return getPreferredGameAssets(game, null).iconUrl;
}

function getApiNotificationIsServerRead(
  notifications: Notification[],
  notificationId: string
) {
  return notifications.find(
    (notification) => notification.id === notificationId
  )?.isRead;
}

function getNotificationFocusKey(notification: MergedNotification) {
  return `${notification.source}:${notification.id}`;
}

function getNotificationItemFocusId(notification: MergedNotification) {
  return `sidebar-notifications-dropdown-item:${getNotificationFocusKey(notification)}`;
}

function getNotificationMenuFocusId(notification: MergedNotification) {
  return `sidebar-notifications-dropdown-menu:${getNotificationFocusKey(notification)}`;
}

export function SidebarNotificationsDropdown({
  anchorRef,
  visible,
  onClose,
  onRestoringFocusChange,
  onUnreadCountChange,
  restoreFocusId,
}: Readonly<SidebarNotificationsDropdownProps>) {
  const navigate = useNavigate();
  const { formatDistance } = useDate();
  const { library } = useLibrary();
  const { setFocus } = useNavigationActions();
  const [apiNotifications, setApiNotifications] = useState<Notification[]>([]);
  const [localNotifications, setLocalNotifications] = useState<
    LocalNotification[]
  >([]);
  const [apiUnreadCount, setApiUnreadCount] = useState(0);
  const [apiUnreadOverrides, setApiUnreadOverrides] = useState<Set<string>>(
    () => new Set()
  );
  const [menuNotification, setMenuNotification] =
    useState<MergedNotification | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [dropdownPosition, setDropdownPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);

  const fetchLocalNotifications = useCallback(async () => {
    if (!IS_DESKTOP) return;

    const notifications =
      await globalThis.window.electron.getLocalNotifications();
    setLocalNotifications(notifications);
  }, []);

  const fetchApiNotifications = useCallback(async () => {
    if (!IS_DESKTOP) return;

    try {
      const [notificationsResponse, countResponse] = await Promise.all([
        globalThis.window.electron.hydraApi.get<NotificationsResponse>(
          "/profile/notifications",
          {
            params: { filter: "all", take: 20, skip: 0 },
            needsAuth: true,
          }
        ),
        globalThis.window.electron.hydraApi.get<NotificationCountResponse>(
          "/profile/notifications/count",
          { needsAuth: true }
        ),
      ]);

      setApiNotifications(notificationsResponse.notifications);
      setApiUnreadCount(countResponse.count);
    } catch {
      setApiNotifications([]);
      setApiUnreadCount(0);
    }
  }, []);

  const refreshNotifications = useCallback(() => {
    if (!IS_DESKTOP) return;

    void fetchLocalNotifications();
    void fetchApiNotifications();
  }, [fetchApiNotifications, fetchLocalNotifications]);

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (!visible) return;
    refreshNotifications();
  }, [refreshNotifications, visible]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeLocal =
      globalThis.window.electron.onLocalNotificationCreated((notification) => {
        setLocalNotifications((current) => [notification, ...current]);
      });
    const unsubscribeSync = globalThis.window.electron.onSyncNotificationCount(
      (notification) => {
        setApiUnreadCount(notification.notificationCount);
        void fetchApiNotifications();
      }
    );
    const handleNotificationsChanged = () => {
      refreshNotifications();
    };

    globalThis.window.addEventListener(
      "notificationsChanged",
      handleNotificationsChanged
    );

    return () => {
      unsubscribeLocal();
      unsubscribeSync();
      globalThis.window.removeEventListener(
        "notificationsChanged",
        handleNotificationsChanged
      );
    };
  }, [fetchApiNotifications, refreshNotifications]);

  const mergedNotifications = useMemo<MergedNotification[]>(() => {
    const apiWithSource = apiNotifications.map((notification) => ({
      ...notification,
      isRead: apiUnreadOverrides.has(notification.id)
        ? false
        : notification.isRead,
      source: "api" as const,
    }));
    const localWithSource = localNotifications.map((notification) => ({
      ...notification,
      source: "local" as const,
    }));

    return [...apiWithSource, ...localWithSource].sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [apiNotifications, apiUnreadOverrides, localNotifications]);

  const unreadCount = useMemo(() => {
    const localUnreadCount = localNotifications.filter(
      (notification) => !notification.isRead
    ).length;
    return apiUnreadCount + localUnreadCount + apiUnreadOverrides.size;
  }, [apiUnreadCount, apiUnreadOverrides.size, localNotifications]);

  useEffect(() => {
    onUnreadCountChange(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  const initialFocusId =
    mergedNotifications.length > 0
      ? getNotificationItemFocusId(mergedNotifications[0])
      : undefined;

  useLayoutEffect(() => {
    if (!visible) return;

    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDropdownPosition({
      left: rect.right + DROPDOWN_OFFSET,
      top: rect.top - 24,
    });
  }, [anchorRef, visible]);

  const notifyCountChange = () => {
    globalThis.window.dispatchEvent(new CustomEvent("notificationsChanged"));
  };

  const closeAndRestoreFocus = useCallback(() => {
    onRestoringFocusChange(true);
    onClose();
    globalThis.window.requestAnimationFrame(() => {
      setFocus(restoreFocusId);
      globalThis.window.requestAnimationFrame(() => {
        onRestoringFocusChange(false);
      });
    });
  }, [onClose, onRestoringFocusChange, restoreFocusId, setFocus]);

  useEffect(() => {
    if (!visible) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(".sidebar-notifications-dropdown") ||
        target?.closest(".context-menu") ||
        target === anchorRef.current ||
        anchorRef.current?.contains(target)
      ) {
        return;
      }

      closeAndRestoreFocus();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAndRestoreFocus();
    };

    globalThis.document.addEventListener("mousedown", handlePointerDown);
    globalThis.window.addEventListener("keydown", handleEscape);

    return () => {
      globalThis.document.removeEventListener("mousedown", handlePointerDown);
      globalThis.window.removeEventListener("keydown", handleEscape);
    };
  }, [anchorRef, closeAndRestoreFocus, visible]);

  const markAsRead = async (notification: MergedNotification) => {
    if (notification.source === "local") {
      await globalThis.window.electron.markLocalNotificationRead(
        notification.id
      );
      setLocalNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, isRead: true } : item
        )
      );
    } else {
      const wasUnreadOverride = apiUnreadOverrides.has(notification.id);
      const serverIsRead =
        getApiNotificationIsServerRead(apiNotifications, notification.id) ??
        notification.isRead;

      setApiUnreadOverrides((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
      await globalThis.window.electron.hydraApi.patch(
        `/profile/notifications/${notification.id}/read`,
        {
          data: { id: notification.id },
          needsAuth: true,
        }
      );
      setApiNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, isRead: true } : item
        )
      );
      if (!wasUnreadOverride && !serverIsRead) {
        setApiUnreadCount((current) => Math.max(0, current - 1));
      }
    }

    notifyCountChange();
  };

  const markAsUnread = async (notification: MergedNotification) => {
    if (notification.source === "local") {
      await globalThis.window.electron.markLocalNotificationUnread(
        notification.id
      );
      setLocalNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, isRead: false } : item
        )
      );
    } else {
      setApiUnreadOverrides((current) => {
        const next = new Set(current);
        next.add(notification.id);
        return next;
      });
    }

    notifyCountChange();
  };

  const dismissNotification = async (notification: MergedNotification) => {
    if (notification.source === "local") {
      await globalThis.window.electron.deleteLocalNotification(notification.id);
      setLocalNotifications((current) =>
        current.filter((item) => item.id !== notification.id)
      );
    } else {
      const wasUnreadOverride = apiUnreadOverrides.has(notification.id);
      const serverIsRead =
        getApiNotificationIsServerRead(apiNotifications, notification.id) ??
        notification.isRead;

      await globalThis.window.electron.hydraApi.delete(
        `/profile/notifications/${notification.id}`,
        { needsAuth: true }
      );
      setApiNotifications((current) =>
        current.filter((item) => item.id !== notification.id)
      );
      setApiUnreadOverrides((current) => {
        const next = new Set(current);
        next.delete(notification.id);
        return next;
      });
      if (!wasUnreadOverride && !serverIsRead) {
        setApiUnreadCount((current) => Math.max(0, current - 1));
      }
    }

    notifyCountChange();
  };

  const openNotification = async (notification: MergedNotification) => {
    if (!notification.isRead) {
      await markAsRead(notification);
    }

    const url = getNotificationUrl(notification);
    if (url) {
      navigate(resolveBigPicturePath(url));
      closeAndRestoreFocus();
    }
  };

  const openMenuFromElement = (
    element: HTMLElement | null,
    notification: MergedNotification
  ) => {
    if (!element) return;

    const rect = element.getBoundingClientRect();
    setMenuNotification(notification);
    setMenuPosition({ x: rect.right, y: rect.top });
  };

  const openMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    notification: MergedNotification
  ) => {
    event.stopPropagation();
    setMenuNotification(notification);
    setMenuPosition({ x: event.clientX, y: event.clientY });
  };

  const updateFriendRequest = (
    senderId: string,
    action: FriendRequestAction
  ) => {
    return globalThis.window.electron.hydraApi.patch(
      `/profile/friend-requests/${senderId}`,
      {
        data: {
          requestState: action,
        },
        needsAuth: true,
      }
    );
  };

  const acceptFriendRequest = async (notification: MergedNotification) => {
    if (
      notification.source !== "api" ||
      notification.type !== "FRIEND_REQUEST_RECEIVED"
    ) {
      return;
    }

    const senderId = notification.variables.senderId;
    if (!senderId) return;

    await updateFriendRequest(senderId, "ACCEPTED");
    await dismissNotification(notification);
  };

  const refuseFriendRequest = async (notification: MergedNotification) => {
    if (
      notification.source !== "api" ||
      notification.type !== "FRIEND_REQUEST_RECEIVED"
    ) {
      return;
    }

    const senderId = notification.variables.senderId;
    if (!senderId) return;

    await updateFriendRequest(senderId, "REFUSED");
    await dismissNotification(notification);
  };

  const buildMenuItems = (
    notification: MergedNotification
  ): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    const notificationUrl = getNotificationUrl(notification);

    if (
      notification.source === "local" &&
      notification.type === "UPDATE_AVAILABLE"
    ) {
      items.push({
        id: "update-now",
        label: "Update Now",
        icon: <CheckCircleIcon size={18} />,
        onSelect: () => globalThis.window.electron.restartAndInstallUpdate(),
      });
    }

    if (
      notificationUrl &&
      notification.source === "local" &&
      (notification.type === "DOWNLOAD_COMPLETE" ||
        notification.type === "EXTRACTION_COMPLETE")
    ) {
      items.push({
        id: "open-game",
        label: "Open Game",
        icon: <DownloadSimpleIcon size={18} />,
        onSelect: () => {
          navigate(resolveBigPicturePath(notificationUrl));
          closeAndRestoreFocus();
        },
      });
    }

    if (
      notification.source === "api" &&
      notification.type === "FRIEND_REQUEST_RECEIVED"
    ) {
      items.push(
        {
          id: "accept-friend-request",
          label: "Accept Request",
          icon: <UserCheckIcon size={18} />,
          onSelect: () => acceptFriendRequest(notification),
        },
        {
          id: "refuse-friend-request",
          label: "Refuse Request",
          icon: <UserMinusIcon size={18} />,
          onSelect: () => refuseFriendRequest(notification),
        }
      );
    }

    items.push(
      notification.isRead
        ? {
            id: "mark-unread",
            label: "Mark as Unread",
            icon: <MinusCircleIcon size={18} />,
            onSelect: () => markAsUnread(notification),
          }
        : {
            id: "mark-read",
            label: "Mark as Read",
            icon: <CheckCircleIcon size={18} />,
            onSelect: () => markAsRead(notification),
          },
      {
        id: "dismiss",
        label: "Dismiss Notification",
        icon: <TrashIcon size={18} />,
        danger: true,
        onSelect: () => dismissNotification(notification),
      }
    );

    return items;
  };

  const renderNotificationIcon = (notification: MergedNotification) => {
    const gameImageUrl = getGameImageUrlFromLibrary(notification, library);

    if (gameImageUrl) {
      return <img src={gameImageUrl} alt="" />;
    }

    if (isAchievementNotification(notification)) {
      return (
        <div className="sidebar-notifications-dropdown__fallback-icon">
          <TrophyIcon
            size={24}
            className="sidebar-notifications-dropdown__fallback-symbol"
          />
        </div>
      );
    }

    if (isHydraNotification(notification)) {
      return (
        <div className="sidebar-notifications-dropdown__fallback-icon">
          <img
            src={hydraIconUrl}
            alt=""
            className="sidebar-notifications-dropdown__fallback-image"
          />
        </div>
      );
    }

    return (
      <div className="sidebar-notifications-dropdown__fallback-icon">
        <img
          src={hydraIconUrl}
          alt=""
          className="sidebar-notifications-dropdown__fallback-image"
        />
      </div>
    );
  };

  if (!visible || globalThis.document === undefined) {
    return null;
  }

  const portalTarget =
    globalThis.document.getElementById("big-picture") ??
    globalThis.document.getElementById("root") ??
    globalThis.document.body;

  return createPortal(
    <FocusRegionContext.Provider value={null}>
      <NavigationLayer
        rootRegionId={DROPDOWN_REGION_ID}
        initialFocusId={initialFocusId}
      >
        <VerticalFocusGroup regionId={DROPDOWN_REGION_ID} asChild>
          <div
            className="sidebar-notifications-dropdown"
            style={{
              left: dropdownPosition?.left ?? 316,
              top: dropdownPosition?.top ?? 24,
            }}
          >
            <div className="sidebar-notifications-dropdown__header">
              <div className="sidebar-notifications-dropdown__title">
                Notifications
                {unreadCount > 0 ? (
                  <span className="sidebar-notifications-dropdown__badge">
                    {unreadCount}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="sidebar-notifications-dropdown__close"
                onClick={closeAndRestoreFocus}
                aria-label="Close notifications"
              >
                <XIcon size={28} />
              </button>
            </div>

            <div className="sidebar-notifications-dropdown__divider" />

            <ScrollArea className="sidebar-notifications-dropdown__scroll">
              <div className="sidebar-notifications-dropdown__list">
                {mergedNotifications.length === 0 ? (
                  <div className="sidebar-notifications-dropdown__empty">
                    No notifications
                  </div>
                ) : (
                  mergedNotifications.map((notification, index) => {
                    const content = getNotificationContent(notification);
                    const createdAt = new Date(notification.createdAt);
                    const itemFocusId =
                      getNotificationItemFocusId(notification);
                    const menuFocusId =
                      getNotificationMenuFocusId(notification);
                    const previousNotification = mergedNotifications[index - 1];
                    const nextNotification = mergedNotifications[index + 1];

                    return (
                      <FocusItem
                        key={`${notification.source}-${notification.id}`}
                        id={itemFocusId}
                        actions={{
                          primary: () => {
                            void openNotification(notification);
                          },
                          press: {
                            y: ({ itemId }) => {
                              openMenuFromElement(
                                globalThis.document.getElementById(itemId),
                                notification
                              );
                            },
                          },
                        }}
                        navigationOverrides={{
                          up: previousNotification
                            ? {
                                type: "item",
                                itemId:
                                  getNotificationItemFocusId(
                                    previousNotification
                                  ),
                              }
                            : {
                                type: "block",
                              },
                          down: nextNotification
                            ? {
                                type: "item",
                                itemId:
                                  getNotificationItemFocusId(nextNotification),
                              }
                            : {
                                type: "block",
                              },
                          right: {
                            type: "item",
                            itemId: menuFocusId,
                          },
                        }}
                        asChild
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          data-navigation-click
                          className={cn(
                            "sidebar-notifications-dropdown__item",
                            {
                              "sidebar-notifications-dropdown__item--unread":
                                !notification.isRead,
                            }
                          )}
                          onClick={() => {
                            void openNotification(notification);
                          }}
                          onKeyDown={(event) => {
                            if (event.currentTarget !== event.target) return;
                            if (event.key !== "Enter" && event.key !== " ") {
                              return;
                            }

                            event.preventDefault();
                            void openNotification(notification);
                          }}
                        >
                          <div className="sidebar-notifications-dropdown__media">
                            {renderNotificationIcon(notification)}
                            {!notification.isRead ? (
                              <span className="sidebar-notifications-dropdown__unread-dot" />
                            ) : null}
                          </div>
                          <div className="sidebar-notifications-dropdown__content">
                            <div className="sidebar-notifications-dropdown__item-title">
                              {content.title}
                            </div>
                            <div className="sidebar-notifications-dropdown__description">
                              {content.description}
                            </div>
                          </div>
                          <div className="sidebar-notifications-dropdown__meta">
                            <span>
                              {formatDistance(createdAt, new Date(), {
                                addSuffix: true,
                              })}
                            </span>
                            <FocusItem
                              id={menuFocusId}
                              actions={{
                                primary: "auto",
                                press: {
                                  y: ({ itemId }) => {
                                    openMenuFromElement(
                                      globalThis.document.getElementById(
                                        itemId
                                      ),
                                      notification
                                    );
                                  },
                                },
                              }}
                              navigationOverrides={{
                                left: {
                                  type: "item",
                                  itemId: itemFocusId,
                                },
                                up: previousNotification
                                  ? {
                                      type: "item",
                                      itemId:
                                        getNotificationMenuFocusId(
                                          previousNotification
                                        ),
                                    }
                                  : {
                                      type: "block",
                                    },
                                down: nextNotification
                                  ? {
                                      type: "item",
                                      itemId:
                                        getNotificationMenuFocusId(
                                          nextNotification
                                        ),
                                    }
                                  : {
                                      type: "block",
                                    },
                                right: {
                                  type: "block",
                                },
                              }}
                              asChild
                            >
                              <button
                                type="button"
                                className="sidebar-notifications-dropdown__menu-button"
                                onClick={(event) =>
                                  openMenu(event, notification)
                                }
                                aria-label="Open notification menu"
                              >
                                <DotsThreeVerticalIcon size={24} />
                              </button>
                            </FocusItem>
                          </div>
                        </div>
                      </FocusItem>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        </VerticalFocusGroup>
      </NavigationLayer>

      <ContextMenu
        visible={Boolean(menuNotification)}
        position={menuPosition}
        items={menuNotification ? buildMenuItems(menuNotification) : []}
        onClose={() => setMenuNotification(null)}
        ariaLabel="Notification menu"
      />
      {!menuNotification ? (
        <SidebarNotificationsBackAction onBack={closeAndRestoreFocus} />
      ) : null}
    </FocusRegionContext.Provider>,
    portalTarget
  );
}
