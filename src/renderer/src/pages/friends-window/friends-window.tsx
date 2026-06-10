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
const REFRESH_INTERVAL_MS = 30_000;
const COPIED_FEEDBACK_MS = 1200;

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

  const fetchFriends = useCallback(async () => {
    try {
      const response = await window.electron.hydraApi.get<ProfileFriends>(
        "/profile/friends",
        { params: { take: PAGE_SIZE, skip: 0 } }
      );

      setFriends(response.friends);
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
    const interval = setInterval(() => {
      fetchFriends();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [fetchFriends]);

  useEffect(() => {
    const unsubscribeFriends = window.electron.onFriendsUpdated(() => {
      fetchFriends();
    });
    const unsubscribeRequests = window.electron.onSyncFriendRequests(() => {
      fetchFriendRequests();
    });
    const unsubscribeProfile = window.electron.onProfileUpdated(() => {
      refreshUserDetails();
    });

    return () => {
      unsubscribeFriends();
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
        const response = await window.electron.hydraApi.get<{
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

  const selfGame = useAppSelector((state) => state.gameRunning.gameRunning);

  const requestsCollapsed = requestsOverride ?? receivedRequests.length === 0;

  const handleCopyFriendCode = () => {
    if (!profile?.id) return;

    navigator.clipboard.writeText(profile.id);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS);
  };

  const handleFriendClick = (friendId: string) => {
    window.electron.openFriendProfileInMainWindow(friendId);
  };

  const handleAddFriend = () => {
    // The add-friend modal is too large for this tiny window, so open it in the
    // main window instead.
    window.electron.openAddFriendModalInMainWindow();
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

  const renderFriend = (friend: UserFriend) => (
    <li
      key={friend.id}
      className={`friends-window__friend${
        friend.backgroundImageUrl ? " friends-window__friend--has-bg" : ""
      }`}
    >
      {friend.backgroundImageUrl && (
        <img
          src={friend.backgroundImageUrl}
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
            src={friend.profileImageUrl}
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

  return (
    <div className="friends-window">
      <div
        className={`friends-window__header${
          profile?.backgroundImageUrl ? " friends-window__header--has-bg" : ""
        }`}
      >
        {profile?.backgroundImageUrl && (
          <img
            src={profile.backgroundImageUrl}
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
              onClick={() => window.electron.minimizeFriendsWindow()}
              title={t("minimize")}
              aria-label={t("minimize")}
            >
              <DashIcon size={16} />
            </button>
            <button
              type="button"
              className="friends-window__window-control friends-window__window-control--close"
              onClick={() => window.electron.closeFriendsWindow()}
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
                  src={profile?.profileImageUrl}
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
                            src={request.profileImageUrl}
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
            searchResults !== null ? t("no_results") : t("no_friends")
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
