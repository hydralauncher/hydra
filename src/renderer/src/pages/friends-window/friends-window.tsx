import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CommentIcon,
  CopyIcon,
  DashIcon,
  PersonAddIcon,
  SearchIcon,
  XIcon,
} from "@primer/octicons-react";

import { Avatar, Button, Toast } from "@renderer/components";
import { closeToast, setFriendRequests } from "@renderer/features";
import {
  useAppDispatch,
  useAppSelector,
  useUserDetails,
} from "@renderer/hooks";
import { useCustomTheme } from "@renderer/hooks/use-custom-theme";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { fetchAllProfileFriends, PROFILE_FRIENDS_PATH } from "@shared";
import type {
  ChatUnreadState,
  FriendRequest,
  ProfileFriends,
  UserFriend,
} from "@types";

import {
  BACKGROUND_IMAGE_SIZES,
  sortFriendsByUnreadMessages,
} from "./friends-window-layout";
import { useVisibleFriendIds } from "./use-visible-friend-ids";
import { useAddFriend } from "./use-add-friend";
import "./friends-window.scss";

const PAGE_SIZE = 100;
const COPIED_FEEDBACK_MS = 1200;
const electron = globalThis.electron as Electron;

type FriendImageSize = { width: number; height: number };

const FRIEND_AVATAR_IMAGE_SIZE = { width: 80, height: 80 };
const PROFILE_AVATAR_IMAGE_SIZE = { width: 112, height: 112 };
const FRIEND_IMAGE_PROCESSING_BATCH_SIZE = 6;

// [name width, status width] per placeholder row; varied so the skeleton reads
// as a list of people rather than a grid.
const ONLINE_SKELETON_ROWS = [
  [128, 92],
  [96, 52],
  [150, 108],
];
const OFFLINE_SKELETON_ROWS = [
  [112, 48],
  [140, 48],
  [84, 48],
  [124, 48],
  [100, 48],
  [136, 48],
];
// Rows from this index on fade out to hint that the list keeps going.
const SKELETON_FADE_FROM_ROW = 3;
// Opacity each faded row loses relative to the one above it.
const SKELETON_FADE_STEP = 0.25;
const SKELETON_ROW_STAGGER_MS = 90;
const MAX_UNREAD_BADGE_COUNT = 99;

type SectionTone = "online" | "offline";

const isRemoteImageUrl = (
  imageUrl: string | null | undefined
): imageUrl is string =>
  Boolean(imageUrl?.startsWith("http://") || imageUrl?.startsWith("https://"));

const getProcessedImageKey = (imageUrl: string, size: FriendImageSize) =>
  `${size.width}x${size.height}:${imageUrl}`;

export default function FriendsWindow() {
  useCustomTheme();
  const { t } = useTranslation("friends_window");
  const { t: tProfile } = useTranslation("user_profile");
  const dispatch = useAppDispatch();
  const toast = useAppSelector((state) => state.toast);
  const handleToastClose = useCallback(() => {
    dispatch(closeToast());
  }, [dispatch]);

  const {
    userDetails,
    friendRequests,
    fetchUserDetails,
    updateUserDetails,
    fetchFriendRequests,
    updateFriendRequestState,
  } = useUserDetails();

  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(true);
  const [hasResolvedSnapshot, setHasResolvedSnapshot] = useState(false);
  const [chatUnread, setChatUnread] = useState<ChatUnreadState>({
    totalUnread: 0,
    byFriend: {},
  });

  useEffect(() => {
    let cancelled = false;

    electron
      .getChatUnreadState()
      .then((state) => {
        if (!cancelled) setChatUnread(state);
      })
      .catch(() => {});
    const unsubscribe = electron.onChatUnreadUpdated(setChatUnread);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  const [search, setSearch] = useState("");
  const [isAddMode, setIsAddMode] = useState(false);
  const [sentRequestsCollapsed, setSentRequestsCollapsed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchResults, setSearchResults] = useState<UserFriend[] | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [processedImages, setProcessedImages] = useState<
    Record<string, string>
  >({});
  const { visibleFriendIds, observeFriendElement, isObservationSupported } =
    useVisibleFriendIds();
  const shouldLoadFriendImages = useCallback(
    (friendId: string) =>
      !isObservationSupported || visibleFriendIds.has(friendId),
    [isObservationSupported, visibleFriendIds]
  );

  // Presence bursts fire overlapping refetches; only the latest one may write,
  // so a slow, older response can't roll the list back.
  const friendsRequestIdRef = useRef(0);

  const fetchFriends = useCallback(async () => {
    const requestId = ++friendsRequestIdRef.current;

    try {
      const response = await fetchAllProfileFriends((take, skip) =>
        electron.hydraApi.get<ProfileFriends>(PROFILE_FRIENDS_PATH, {
          params: { take, skip },
        })
      );

      if (requestId === friendsRequestIdRef.current) {
        setFriends(response.friends);
      }
    } catch {
      // ignore transient errors; the next refresh will retry
    } finally {
      // Drop the skeleton even on failure so it can't shimmer forever.
      setIsLoadingFriends(false);
    }
  }, []);

  const refreshUserDetails = useCallback(() => {
    // fetchUserDetails() only returns the data; updateUserDetails() writes it
    // into this window's store.
    return fetchUserDetails().then((details) => {
      if (details) updateUserDetails(details);
    });
  }, [fetchUserDetails, updateUserDetails]);

  useEffect(() => {
    document.title = t("title");
  }, [t]);

  useEffect(() => {
    let cancelled = false;

    // This window has its own Redux store, so hydrate the signed-in user.
    refreshUserDetails();

    // Paint the list the main window prefetched, then revalidate. Fetching only
    // after the snapshot lands keeps it from overwriting a fresher response.
    void electron
      .getFriendsSnapshot()
      .catch(() => null)
      .then((snapshot) => {
        if (cancelled) return;

        if (snapshot) {
          setFriends(snapshot.friends);
          dispatch(setFriendRequests(snapshot.friendRequests));
          setIsLoadingFriends(false);
        }

        setHasResolvedSnapshot(true);
        fetchFriends();
        fetchFriendRequests();
      });

    return () => {
      cancelled = true;
    };
  }, [dispatch, refreshUserDetails, fetchFriends, fetchFriendRequests]);

  useEffect(() => {
    if (!hasResolvedSnapshot) return;

    // Main keeps the window hidden until this frame (cached list or skeleton)
    // is on screen.
    const frame = requestAnimationFrame(() => electron.friendsWindowReady());

    return () => cancelAnimationFrame(frame);
  }, [hasResolvedSnapshot]);

  useEffect(() => {
    const unsubscribeFriends = electron.onFriendsUpdated(() => {
      fetchFriends();
    });
    let interval: ReturnType<typeof setInterval> | null = null;
    const unsubscribePresence =
      typeof electron.onFriendPresence === "function"
        ? electron.onFriendPresence(({ friendId, isOnline }) => {
            setFriends((prev) =>
              prev.map((friend) =>
                friend.id === friendId ? { ...friend, isOnline } : friend
              )
            );
          })
        : () => {
            if (interval) clearInterval(interval);
          };

    if (typeof electron.onFriendPresence !== "function") {
      interval = setInterval(fetchFriends, 30_000);
    }
    const unsubscribeRequests = electron.onSyncFriendRequests(() => {
      fetchFriendRequests();
    });
    const unsubscribeProfile = electron.onProfileUpdated(() => {
      refreshUserDetails();
    });

    return () => {
      unsubscribeFriends();
      unsubscribePresence();
      unsubscribeRequests();
      unsubscribeProfile();
    };
  }, [fetchFriends, fetchFriendRequests, refreshUserDetails]);

  // Debounced friend search
  useEffect(() => {
    const query = search.trim();

    if (!query) {
      setSearchResults(null);
      return;
    }

    const timeout = setTimeout(async () => {
      try {
        const response = await electron.hydraApi.get<{
          friends: UserFriend[];
        }>("/profile/friends/search", {
          params: { query, take: PAGE_SIZE, skip: 0 },
        });

        setSearchResults(response.friends);
      } catch {
        setSearchResults([]);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [search]);

  // /profile/friends/search does not return isOnline, so reuse the presence
  // info we already have from the full friends list.
  const onlineMap = useMemo(() => {
    const map = new Map<string, boolean>();
    friends.forEach((friend) => map.set(friend.id, Boolean(friend.isOnline)));
    return map;
  }, [friends]);

  const displayedFriends = useMemo(() => {
    if (searchResults === null) return friends;

    return searchResults.map((friend) => ({
      ...friend,
      isOnline: friend.isOnline ?? onlineMap.get(friend.id) ?? false,
    }));
  }, [searchResults, friends, onlineMap]);

  const sortedFriends = useMemo(
    () =>
      sortFriendsByUnreadMessages(
        displayedFriends,
        chatUnread.byFriend,
        chatUnread.lastMessageAtByFriend ?? {}
      ),
    [displayedFriends, chatUnread]
  );

  const onlineFriends = sortedFriends.filter((friend) => friend.isOnline);
  const offlineFriends = sortedFriends.filter((friend) => !friend.isOnline);

  // null = follow the default (collapsed when the section is empty); a boolean
  // means the user explicitly toggled it.
  const [onlineOverride, setOnlineOverride] = useState<boolean | null>(null);
  const [offlineOverride, setOfflineOverride] = useState<boolean | null>(null);
  const [requestsOverride, setRequestsOverride] = useState<boolean | null>(
    null
  );

  const onlineCollapsed = onlineOverride ?? onlineFriends.length === 0;
  const offlineCollapsed = offlineOverride ?? offlineFriends.length === 0;

  const receivedRequests = friendRequests.filter(
    (request) => request.type === "RECEIVED"
  );

  const [requestBackgrounds, setRequestBackgrounds] = useState<
    Record<string, string | null>
  >({});
  const requestedBackgroundIdsRef = useRef(new Set<string>());

  useEffect(() => {
    for (const request of friendRequests) {
      if (requestedBackgroundIdsRef.current.has(request.id)) continue;
      requestedBackgroundIdsRef.current.add(request.id);

      electron.hydraApi
        .get<{ backgroundImageUrl: string | null }>(`/users/${request.id}`)
        .then(({ backgroundImageUrl }) => {
          setRequestBackgrounds((current) => ({
            ...current,
            [request.id]: backgroundImageUrl ?? null,
          }));
        })
        .catch(() => {
          requestedBackgroundIdsRef.current.delete(request.id);
        });
    }
  }, [friendRequests]);

  const profile = userDetails;

  useEffect(() => {
    if (typeof electron.getProcessedImage !== "function") return;

    const pendingImages = new Map<
      string,
      { imageUrl: string; size: FriendImageSize }
    >();

    const addImage = (
      imageUrl: string | null | undefined,
      size: FriendImageSize
    ) => {
      if (!isRemoteImageUrl(imageUrl)) return;

      const key = getProcessedImageKey(imageUrl, size);

      if (!processedImages[key]) {
        pendingImages.set(key, { imageUrl, size });
      }
    };

    addImage(profile?.profileImageUrl, PROFILE_AVATAR_IMAGE_SIZE);
    addImage(profile?.backgroundImageUrl, BACKGROUND_IMAGE_SIZES.profile);

    for (const friend of friends) {
      if (!shouldLoadFriendImages(friend.id)) continue;
      addImage(friend.profileImageUrl, FRIEND_AVATAR_IMAGE_SIZE);
      addImage(friend.backgroundImageUrl, BACKGROUND_IMAGE_SIZES.friend);
    }

    for (const friend of searchResults ?? []) {
      if (!shouldLoadFriendImages(friend.id)) continue;
      addImage(friend.profileImageUrl, FRIEND_AVATAR_IMAGE_SIZE);
      addImage(friend.backgroundImageUrl, BACKGROUND_IMAGE_SIZES.friend);
    }

    for (const request of friendRequests) {
      addImage(request.profileImageUrl, FRIEND_AVATAR_IMAGE_SIZE);
      addImage(requestBackgrounds[request.id], BACKGROUND_IMAGE_SIZES.friend);
    }

    if (!pendingImages.size) return;

    let cancelled = false;

    const loadImages = async () => {
      const entries = [...pendingImages.entries()];
      for (
        let index = 0;
        index < entries.length;
        index += FRIEND_IMAGE_PROCESSING_BATCH_SIZE
      ) {
        const batch = entries.slice(
          index,
          index + FRIEND_IMAGE_PROCESSING_BATCH_SIZE
        );

        await Promise.all(
          batch.map(async ([key, { imageUrl, size }]) => {
            const processedImageUrl = await electron
              .getProcessedImage(imageUrl, {
                width: size.width,
                height: size.height,
                preserveAnimation: true,
              })
              .catch(() => imageUrl);

            if (cancelled) return;

            setProcessedImages((current) => {
              if (current[key] === processedImageUrl) return current;

              return {
                ...current,
                [key]: processedImageUrl ?? imageUrl,
              };
            });
          })
        );

        if (cancelled) return;
      }
    };

    loadImages();

    return () => {
      cancelled = true;
    };
  }, [
    friends,
    friendRequests,
    profile,
    processedImages,
    requestBackgrounds,
    searchResults,
    shouldLoadFriendImages,
  ]);

  const getProcessedImageUrl = (
    imageUrl: string | null | undefined,
    size: FriendImageSize
  ) => {
    if (!imageUrl) return imageUrl;

    const processedImageUrl =
      processedImages[getProcessedImageKey(imageUrl, size)];
    if (processedImageUrl) return processedImageUrl;

    const canProcessImages = typeof electron.getProcessedImage === "function";
    return canProcessImages && isRemoteImageUrl(imageUrl)
      ? undefined
      : imageUrl;
  };

  const selfGame = useAppSelector((state) => state.gameRunning.gameRunning);

  const requestsCollapsed = requestsOverride ?? receivedRequests.length === 0;

  const handleCopyFriendCode = () => {
    if (!profile?.id) return;

    navigator.clipboard.writeText(profile.id);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS);
  };

  const handleFriendClick = (friendId: string) => {
    electron.openFriendProfileInMainWindow(friendId);
  };

  const handleMessageFriend = (friend: UserFriend) => {
    void electron.openChatWindow(friend);
  };

  const friendIds = useMemo(
    () => new Set(friends.map((friend) => friend.id)),
    [friends]
  );
  const addFriend = useAddFriend({
    isFriend: (userId) => friendIds.has(userId),
    onOpenProfile: handleFriendClick,
  });
  const sentRequests = friendRequests.filter(
    (request) => request.type === "SENT"
  );
  const searchFieldValue = isAddMode ? addFriend.friendCode : search;

  const handleSearchFieldChange = (value: string) => {
    if (isAddMode) addFriend.changeFriendCode(value);
    else setSearch(value);
  };

  const handleToggleAddMode = () => {
    setIsAddMode((current) => !current);
    addFriend.changeFriendCode("");
    setSearch("");
    searchInputRef.current?.focus();
  };

  const handleSearchFieldKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (!isAddMode) return;

    if (event.key === "Enter") {
      event.preventDefault();
      void addFriend.sendRequest();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleToggleAddMode();
    }
  };

  const handleAcceptRequest = (userId: string) => {
    updateFriendRequestState(userId, "ACCEPTED")
      .then(() => fetchFriends())
      .catch(() => {});
  };

  const handleRefuseRequest = (userId: string) => {
    updateFriendRequestState(userId, "REFUSED").catch(() => {});
  };

  const getGameIcon = (game: { iconUrl: string | null; title: string }) => {
    if (game.iconUrl) {
      return (
        <img
          className="friends-window__game-icon"
          alt={game.title}
          width={16}
          height={16}
          src={game.iconUrl}
        />
      );
    }

    return <SteamLogo width={16} height={16} />;
  };

  const renderRequest = (request: FriendRequest, actions: React.ReactNode) => {
    const backgroundImageUrl = getProcessedImageUrl(
      requestBackgrounds[request.id],
      BACKGROUND_IMAGE_SIZES.friend
    );

    return (
      <li
        key={request.id}
        className={`friends-window__friend${
          backgroundImageUrl ? " friends-window__friend--has-bg" : ""
        }`}
      >
        {backgroundImageUrl && (
          <img
            src={backgroundImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="friends-window__friend-bg"
          />
        )}
        <button
          type="button"
          className="friends-window__friend-button"
          onClick={() => handleFriendClick(request.id)}
        >
          <div className="friends-window__avatar-wrapper">
            <Avatar
              size={40}
              src={getProcessedImageUrl(
                request.profileImageUrl,
                FRIEND_AVATAR_IMAGE_SIZE
              )}
              alt={request.displayName}
            />
          </div>
          <span className="friends-window__friend-name">
            {request.displayName}
          </span>
        </button>
        <div className="friends-window__request-actions">{actions}</div>
      </li>
    );
  };

  const renderFriend = (friend: UserFriend) => {
    const backgroundImageUrl = getProcessedImageUrl(
      friend.backgroundImageUrl,
      BACKGROUND_IMAGE_SIZES.friend
    );
    const unreadCount = chatUnread.byFriend[friend.id] ?? 0;
    const messageLabel =
      unreadCount > 0
        ? `${t("message_friend", { name: friend.displayName })}, ${t(
            "unread_messages",
            { count: unreadCount }
          )}`
        : t("message_friend", { name: friend.displayName });

    return (
      <li
        key={friend.id}
        ref={observeFriendElement(friend.id)}
        data-friend-id={friend.id}
        className={`friends-window__friend${
          backgroundImageUrl ? " friends-window__friend--has-bg" : ""
        }`}
      >
        {backgroundImageUrl && (
          <img
            src={backgroundImageUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="friends-window__friend-bg"
          />
        )}
        <button
          type="button"
          className="friends-window__friend-button"
          onClick={() => handleFriendClick(friend.id)}
          title={
            friend.currentGame
              ? t("playing", { game: friend.currentGame.title })
              : undefined
          }
        >
          <div className="friends-window__avatar-wrapper">
            <Avatar
              size={40}
              src={getProcessedImageUrl(
                friend.profileImageUrl,
                FRIEND_AVATAR_IMAGE_SIZE
              )}
              alt={friend.displayName}
              loading="lazy"
              decoding="async"
            />
            <span
              className={`friends-window__status-orb${
                friend.isOnline ? " friends-window__status-orb--online" : ""
              }`}
            />
          </div>

          <div className="friends-window__friend-details">
            <span className="friends-window__friend-name">
              {friend.displayName}
            </span>
            {friend.currentGame ? (
              <div className="friends-window__game-info">
                {getGameIcon(friend.currentGame)}
                <small>{friend.currentGame.title}</small>
              </div>
            ) : (
              <small className="friends-window__friend-status">
                {friend.isOnline ? t("online") : t("offline")}
              </small>
            )}
          </div>
        </button>

        <button
          type="button"
          className={`friends-window__message-button${
            unreadCount > 0 ? " friends-window__message-button--unread" : ""
          }`}
          onClick={() => handleMessageFriend(friend)}
          title={messageLabel}
          aria-label={messageLabel}
        >
          <CommentIcon size={16} />
          {unreadCount > 0 && (
            <span className="friends-window__unread-badge" aria-hidden="true">
              <span className="friends-window__badge-value">
                {unreadCount > MAX_UNREAD_BADGE_COUNT
                  ? `${MAX_UNREAD_BADGE_COUNT}+`
                  : unreadCount}
              </span>
            </span>
          )}
        </button>
      </li>
    );
  };

  const renderCount = (count: number, tone?: SectionTone) => (
    <span
      className={`friends-window__count${
        tone ? ` friends-window__count--${tone}` : ""
      }`}
    >
      <span className="friends-window__badge-value">{count}</span>
    </span>
  );

  const renderSectionHeader = (
    title: string,
    count: number,
    collapsed: boolean,
    onToggle: () => void,
    tone?: SectionTone
  ) => (
    <button
      type="button"
      className="friends-window__section-header"
      onClick={onToggle}
      aria-expanded={!collapsed}
    >
      {collapsed ? (
        <ChevronRightIcon size={16} />
      ) : (
        <ChevronDownIcon size={16} />
      )}
      <span className="friends-window__section-title">{title}</span>
      {renderCount(count, tone)}
    </button>
  );

  const renderCollapsibleSection = (
    title: string,
    count: number,
    list: UserFriend[],
    collapsed: boolean,
    onToggle: () => void,
    emptyText: string,
    tone: SectionTone
  ) => (
    <section className="friends-window__section">
      {renderSectionHeader(title, count, collapsed, onToggle, tone)}

      {!collapsed &&
        (list.length > 0 ? (
          <ul className="friends-window__list">{list.map(renderFriend)}</ul>
        ) : (
          <p className="friends-window__empty">{emptyText}</p>
        ))}
    </section>
  );

  const renderSkeletonSection = (
    title: string,
    rows: number[][],
    firstRowIndex: number,
    fadeFromRow?: number
  ) => (
    <section className="friends-window__section">
      <div className="friends-window__section-header friends-window__section-header--static">
        <ChevronDownIcon size={16} />
        <span className="friends-window__section-title">{title}</span>
        <span className="friends-window__skeleton friends-window__skeleton--count" />
      </div>

      <ul className="friends-window__list">
        {rows.map(([nameWidth, statusWidth], index) => {
          const fadeSteps =
            fadeFromRow === undefined ? 0 : index - fadeFromRow + 1;

          return (
            <li
              key={`${firstRowIndex + index}`}
              className="friends-window__skeleton-row"
              style={
                {
                  "--skeleton-delay": `${
                    (firstRowIndex + index) * SKELETON_ROW_STAGGER_MS
                  }ms`,
                  opacity:
                    fadeSteps > 0
                      ? 1 - fadeSteps * SKELETON_FADE_STEP
                      : undefined,
                } as React.CSSProperties
              }
            >
              <span className="friends-window__skeleton friends-window__skeleton--avatar" />
              <span className="friends-window__skeleton-details">
                <span
                  className="friends-window__skeleton friends-window__skeleton--name"
                  style={{ width: nameWidth }}
                />
                <span
                  className="friends-window__skeleton friends-window__skeleton--status"
                  style={{ width: statusWidth }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  const renderSearchControls = () => {
    const searchPlaceholder = isAddMode
      ? tProfile("friend_code")
      : t("search_placeholder");
    const addFriendToggleLabel = isAddMode ? t("close") : t("add_friend");

    return (
      <>
        <div className="friends-window__search-row">
          <div
            className={`friends-window__search${
              isAddMode ? " friends-window__search--add" : ""
            }`}
          >
            {isAddMode ? (
              <PersonAddIcon
                size={16}
                className="friends-window__search-icon"
              />
            ) : (
              <SearchIcon size={16} className="friends-window__search-icon" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              value={searchFieldValue}
              spellCheck={false}
              onChange={(event) => handleSearchFieldChange(event.target.value)}
              onKeyDown={handleSearchFieldKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="friends-window__search-input"
            />
            {searchFieldValue && (
              <button
                type="button"
                className="friends-window__search-clear"
                onClick={() => handleSearchFieldChange("")}
                title={t("clear_search")}
                aria-label={t("clear_search")}
              >
                <XIcon size={16} />
              </button>
            )}
          </div>
          <Button
            theme="primary"
            className={`friends-window__add-friend${
              isAddMode ? " friends-window__add-friend--active" : ""
            }`}
            onClick={handleToggleAddMode}
            title={addFriendToggleLabel}
            aria-label={addFriendToggleLabel}
            aria-expanded={isAddMode}
          >
            <span
              className="friends-window__add-friend-face friends-window__add-friend-face--add"
              aria-hidden="true"
            >
              <PersonAddIcon size={16} />
            </span>
            <span
              className="friends-window__add-friend-face friends-window__add-friend-face--close"
              aria-hidden="true"
            >
              <XIcon size={16} />
            </span>
          </Button>
        </div>

        {isAddMode && (
          <div className="friends-window__add-actions">
            <Button
              theme="primary"
              disabled={addFriend.isSending}
              onClick={() => void addFriend.sendRequest()}
            >
              <PersonAddIcon size={16} />
              {addFriend.isSending
                ? tProfile("sending")
                : t("send_friend_request")}
            </Button>
            <Button
              theme="outline"
              disabled={addFriend.isSending}
              onClick={() => void addFriend.openProfile()}
            >
              {tProfile("see_profile")}
            </Button>
          </div>
        )}
      </>
    );
  };

  const showSkeleton = isLoadingFriends && searchResults === null;

  const profileBackgroundImageUrl = getProcessedImageUrl(
    profile?.backgroundImageUrl,
    BACKGROUND_IMAGE_SIZES.profile
  );

  return (
    <div className="friends-window">
      <div
        className={`friends-window__header${
          profileBackgroundImageUrl ? " friends-window__header--has-bg" : ""
        }`}
      >
        {profileBackgroundImageUrl && (
          <img
            src={profileBackgroundImageUrl}
            alt=""
            className="friends-window__header-bg"
          />
        )}

        <header className="friends-window__title-bar">
          <h4>{t("title")}</h4>
          <div className="friends-window__window-controls">
            <button
              type="button"
              className="friends-window__window-control"
              onClick={() => electron.minimizeFriendsWindow()}
              title={t("minimize")}
              aria-label={t("minimize")}
            >
              <DashIcon size={16} />
            </button>
            <button
              type="button"
              className="friends-window__window-control friends-window__window-control--close"
              onClick={() => electron.closeFriendsWindow()}
              title={t("close")}
              aria-label={t("close")}
            >
              <XIcon size={16} />
            </button>
          </div>
        </header>

        <section className="friends-window__profile">
          <div className="friends-window__profile-content">
            <button
              type="button"
              className="friends-window__profile-avatar"
              onClick={() => profile?.id && handleFriendClick(profile.id)}
              disabled={!profile?.id}
              title={profile?.displayName}
            >
              <div className="friends-window__avatar-wrapper">
                <Avatar
                  size={56}
                  src={getProcessedImageUrl(
                    profile?.profileImageUrl,
                    PROFILE_AVATAR_IMAGE_SIZE
                  )}
                  alt={profile?.displayName}
                />
                <span className="friends-window__status-orb friends-window__status-orb--online friends-window__status-orb--profile" />
              </div>
            </button>
            <div className="friends-window__profile-info">
              <div className="friends-window__profile-name-row">
                <button
                  type="button"
                  className="friends-window__profile-name"
                  onClick={() => profile?.id && handleFriendClick(profile.id)}
                  disabled={!profile?.id}
                >
                  {profile?.displayName}
                </button>
                {profile?.id && (
                  <button
                    type="button"
                    className={`friends-window__friend-code${
                      isCopied ? " friends-window__friend-code--copied" : ""
                    }`}
                    onClick={handleCopyFriendCode}
                    title={t("copy_friend_code")}
                  >
                    <span className="friends-window__friend-code-value">
                      {isCopied ? t("copied") : profile.id}
                    </span>
                    <CopyIcon size={14} />
                  </button>
                )}
              </div>

              {selfGame ? (
                <div className="friends-window__profile-game">
                  {getGameIcon({
                    iconUrl: selfGame.iconUrl,
                    title: selfGame.title,
                  })}
                  <small>{selfGame.title}</small>
                </div>
              ) : (
                <small className="friends-window__profile-status">
                  {t("online")}
                </small>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="friends-window__content">
        {renderSearchControls()}

        <div
          className="friends-window__list-container"
          aria-busy={showSkeleton}
        >
          {showSkeleton ? (
            <>
              {renderSkeletonSection(t("online"), ONLINE_SKELETON_ROWS, 0)}
              {renderSkeletonSection(
                t("offline"),
                OFFLINE_SKELETON_ROWS,
                ONLINE_SKELETON_ROWS.length,
                SKELETON_FADE_FROM_ROW
              )}
            </>
          ) : (
            <>
              {isAddMode && sentRequests.length > 0 && (
                <section className="friends-window__section">
                  {renderSectionHeader(
                    tProfile("pending"),
                    sentRequests.length,
                    sentRequestsCollapsed,
                    () => setSentRequestsCollapsed((collapsed) => !collapsed)
                  )}

                  {!sentRequestsCollapsed && (
                    <ul className="friends-window__list">
                      {sentRequests.map((request) =>
                        renderRequest(
                          request,
                          <button
                            type="button"
                            className="friends-window__request-action friends-window__request-action--refuse"
                            onClick={() =>
                              addFriend.cancelSentRequest(request.id)
                            }
                            title={tProfile("cancel_request")}
                            aria-label={tProfile("cancel_request")}
                          >
                            <XIcon size={16} />
                          </button>
                        )
                      )}
                    </ul>
                  )}
                </section>
              )}

              {receivedRequests.length > 0 && (
                <section className="friends-window__section">
                  {renderSectionHeader(
                    t("friend_requests"),
                    receivedRequests.length,
                    requestsCollapsed,
                    () => setRequestsOverride(!requestsCollapsed)
                  )}

                  {!requestsCollapsed && (
                    <ul className="friends-window__list">
                      {receivedRequests.map((request) =>
                        renderRequest(
                          request,
                          <>
                            <button
                              type="button"
                              className="friends-window__request-action friends-window__request-action--accept"
                              onClick={() => handleAcceptRequest(request.id)}
                              title={t("accept")}
                            >
                              <CheckIcon size={16} />
                            </button>
                            <button
                              type="button"
                              className="friends-window__request-action friends-window__request-action--refuse"
                              onClick={() => handleRefuseRequest(request.id)}
                              title={t("refuse")}
                            >
                              <XIcon size={16} />
                            </button>
                          </>
                        )
                      )}
                    </ul>
                  )}
                </section>
              )}

              {renderCollapsibleSection(
                t("online"),
                onlineFriends.length,
                onlineFriends,
                onlineCollapsed,
                () => setOnlineOverride(!onlineCollapsed),
                searchResults === null ? t("no_friends") : t("no_results"),
                "online"
              )}

              {offlineFriends.length > 0 &&
                renderCollapsibleSection(
                  t("offline"),
                  offlineFriends.length,
                  offlineFriends,
                  offlineCollapsed,
                  () => setOfflineOverride(!offlineCollapsed),
                  t("no_results"),
                  "offline"
                )}
            </>
          )}
        </div>
      </div>

      <Toast
        visible={toast.visible}
        title={toast.title}
        message={toast.message}
        type={toast.type}
        duration={toast.duration}
        onClose={handleToastClose}
      />
    </div>
  );
}
