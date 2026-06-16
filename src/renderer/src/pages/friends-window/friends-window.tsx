import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  DashIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "@primer/octicons-react";

import { Avatar } from "@renderer/components";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import type { ProfileFriends, UserFriend } from "@types";

import "./friends-window.scss";

const PAGE_SIZE = 100;
const COPIED_FEEDBACK_MS = 1200;
const electron = globalThis.electron as Electron;

type FriendImageSize = { width: number; height: number };

const FRIEND_AVATAR_IMAGE_SIZE = { width: 80, height: 80 };
const PROFILE_AVATAR_IMAGE_SIZE = { width: 112, height: 112 };
const FRIEND_BACKGROUND_IMAGE_SIZE = { width: 480, height: 96 };
const PROFILE_BACKGROUND_IMAGE_SIZE = { width: 420, height: 180 };
const FRIEND_IMAGE_PROCESSING_BATCH_SIZE = 6;

const isRemoteImageUrl = (
  imageUrl: string | null | undefined
): imageUrl is string =>
  Boolean(imageUrl?.startsWith("http://") || imageUrl?.startsWith("https://"));

const getProcessedImageKey = (imageUrl: string, size: FriendImageSize) =>
  `${size.width}x${size.height}:${imageUrl}`;

export default function FriendsWindow() {
  const { t } = useTranslation("friends_window");

  const {
    userDetails,
    friendRequests,
    fetchUserDetails,
    updateUserDetails,
    fetchFriendRequests,
    updateFriendRequestState,
  } = useUserDetails();

  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<UserFriend[] | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [processedImages, setProcessedImages] = useState<
    Record<string, string>
  >({});

  const fetchFriends = useCallback(async () => {
    try {
      const response = await electron.hydraApi.get<ProfileFriends>(
        "/profile/friends",
        { params: { take: PAGE_SIZE, skip: 0 } }
      );

      setFriends(response.friends);
      setOnlineCount(response.onlineFriends);
    } catch {
      // ignore transient errors; the next refresh will retry
    }
  }, []);

  const fetchOnlineFriendsCount = useCallback(async () => {
    try {
      const response = await electron.hydraApi.get<ProfileFriends>(
        "/profile/friends",
        { params: { take: 1, skip: 0 } }
      );

      setOnlineCount(response.onlineFriends);
    } catch {
      // ignore transient errors; the next refresh will retry
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
    // This window has its own Redux store, so hydrate the signed-in user.
    refreshUserDetails();
    fetchFriends();
    fetchFriendRequests();
  }, [refreshUserDetails, fetchFriends, fetchFriendRequests]);

  useEffect(() => {
    const unsubscribeFriends = electron.onFriendsUpdated(() => {
      fetchFriends();
    });
    let interval: ReturnType<typeof setInterval> | null = null;
    const unsubscribePresence =
      typeof electron.onFriendPresence === "function"
        ? electron.onFriendPresence(({ friendId, isOnline }) => {
            // Patch the visible page, but refetch the total because this page is
            // capped and the event can be for an off-page friend.
            setFriends((prev) =>
              prev.map((friend) =>
                friend.id === friendId ? { ...friend, isOnline } : friend
              )
            );
            fetchOnlineFriendsCount();
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
  }, [
    fetchFriends,
    fetchFriendRequests,
    fetchOnlineFriendsCount,
    refreshUserDetails,
  ]);

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

  const onlineFriends = displayedFriends.filter((friend) => friend.isOnline);
  const offlineFriends = displayedFriends.filter((friend) => !friend.isOnline);

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

  const profile = userDetails;

  useEffect(() => {
    if (typeof electron.getProcessedFriendImage !== "function") return;

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
    addImage(profile?.backgroundImageUrl, PROFILE_BACKGROUND_IMAGE_SIZE);

    for (const friend of friends) {
      addImage(friend.profileImageUrl, FRIEND_AVATAR_IMAGE_SIZE);
      addImage(friend.backgroundImageUrl, FRIEND_BACKGROUND_IMAGE_SIZE);
    }

    for (const friend of searchResults ?? []) {
      addImage(friend.profileImageUrl, FRIEND_AVATAR_IMAGE_SIZE);
      addImage(friend.backgroundImageUrl, FRIEND_BACKGROUND_IMAGE_SIZE);
    }

    for (const request of friendRequests) {
      addImage(request.profileImageUrl, FRIEND_AVATAR_IMAGE_SIZE);
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
              .getProcessedFriendImage(imageUrl, {
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
  }, [friends, friendRequests, profile, processedImages, searchResults]);

  const getProcessedImageUrl = (
    imageUrl: string | null | undefined,
    size: FriendImageSize
  ) => {
    if (!imageUrl) return imageUrl;

    return processedImages[getProcessedImageKey(imageUrl, size)] ?? imageUrl;
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

  const handleAddFriend = () => {
    // The add-friend modal is too large for this tiny window, so open it in the
    // main window instead.
    electron.openAddFriendModalInMainWindow();
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

  const renderFriend = (friend: UserFriend) => {
    const backgroundImageUrl = getProcessedImageUrl(
      friend.backgroundImageUrl,
      FRIEND_BACKGROUND_IMAGE_SIZE
    );

    return (
      <li
        key={friend.id}
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
      </li>
    );
  };

  const renderSectionHeader = (
    title: string,
    count: number,
    collapsed: boolean,
    onToggle: () => void
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
      <span className="friends-window__section-title">
        {title} ({count})
      </span>
    </button>
  );

  const renderCollapsibleSection = (
    title: string,
    count: number,
    list: UserFriend[],
    collapsed: boolean,
    onToggle: () => void,
    emptyText: string
  ) => (
    <section className="friends-window__section">
      {renderSectionHeader(title, count, collapsed, onToggle)}

      {!collapsed &&
        (list.length > 0 ? (
          <ul className="friends-window__list">{list.map(renderFriend)}</ul>
        ) : (
          <p className="friends-window__empty">{emptyText}</p>
        ))}
    </section>
  );

  const profileBackgroundImageUrl = getProcessedImageUrl(
    profile?.backgroundImageUrl,
    PROFILE_BACKGROUND_IMAGE_SIZE
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
        <div className="friends-window__search-row">
          <div className="friends-window__search">
            <SearchIcon size={16} className="friends-window__search-icon" />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("search_placeholder")}
              className="friends-window__search-input"
            />
            {search && (
              <button
                type="button"
                className="friends-window__search-clear"
                onClick={() => setSearch("")}
                title={t("clear_search")}
                aria-label={t("clear_search")}
              >
                <XIcon size={16} />
              </button>
            )}
          </div>
          <button
            type="button"
            className="friends-window__add-friend"
            onClick={handleAddFriend}
            title={t("add_friend")}
          >
            <PlusIcon size={16} />
            {t("add_friend")}
          </button>
        </div>

        <div className="friends-window__list-container">
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
                  {receivedRequests.map((request) => (
                    <li key={request.id} className="friends-window__friend">
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
                      <div className="friends-window__request-actions">
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
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {renderCollapsibleSection(
            t("online"),
            onlineCount,
            onlineFriends,
            onlineCollapsed,
            () => setOnlineOverride(!onlineCollapsed),
            searchResults === null ? t("no_friends") : t("no_results")
          )}

          {offlineFriends.length > 0 &&
            renderCollapsibleSection(
              t("offline"),
              offlineFriends.length,
              offlineFriends,
              offlineCollapsed,
              () => setOfflineOverride(!offlineCollapsed),
              t("no_results")
            )}
        </div>
      </div>
    </div>
  );
}
