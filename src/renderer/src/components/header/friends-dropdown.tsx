import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { PeopleIcon } from "@primer/octicons-react";
import { Avatar } from "@renderer/components";
import { useUserDetails } from "@renderer/hooks";
import type { UserFriend, UserFriends } from "@types";

import "./friends-dropdown.scss";

const POLL_INTERVAL_MS = 60_000;
const PAGE_SIZE = 50;

export function FriendsDropdown() {
  const { userDetails } = useUserDetails();
  const navigate = useNavigate();
  const { t } = useTranslation("header");

  const [isOpen, setIsOpen] = useState(false);
  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [totalFriends, setTotalFriends] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isLoadingRef = useRef(false);

  const fetchFriends = useCallback(
    async (pageNum: number, append = false) => {
      if (!userDetails || isLoadingRef.current) return;

      isLoadingRef.current = true;
      setIsLoading(true);
      try {
        const data = await window.electron.hydraApi.get<UserFriends>(
          "/profile/friends",
          { params: { take: PAGE_SIZE, skip: pageNum * PAGE_SIZE } }
        );

        if (append) {
          setFriends((prev) => [...prev, ...data.friends]);
        } else {
          setFriends(data.friends);
        }

        setTotalFriends(data.totalFriends);
        setHasMore((pageNum + 1) * PAGE_SIZE < data.totalFriends);
        setPage(pageNum + 1);
      } catch {
        /* silently ignore */
      } finally {
        isLoadingRef.current = false;
        setIsLoading(false);
      }
    },
    [userDetails]
  );

  // Polling
  useEffect(() => {
    if (!userDetails) return;

    fetchFriends(0);

    const interval = setInterval(() => {
      fetchFriends(0);
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [userDetails, fetchFriends]);

  // Re-fetch on open
  useEffect(() => {
    if (isOpen && userDetails) {
      fetchFriends(0);
    }
  }, [isOpen, fetchFriends, userDetails]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleScroll = useCallback(() => {
    if (!listRef.current || isLoading || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      fetchFriends(page, true);
    }
  }, [isLoading, hasMore, page, fetchFriends]);

  const handleToggle = () => {
    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = 320;
      let x = rect.right - panelWidth;
      const y = rect.bottom + 8;

      if (x < 10) x = 10;

      setPanelPosition({ x, y });
    }
    setIsOpen((prev) => !prev);
  };

  const handleFriendClick = (friendId: string) => {
    navigate(`/profile/${friendId}`);
    setIsOpen(false);
  };

  if (!userDetails) return null;

  const onlineFriends = friends.filter((f) => f.currentGame !== null);
  const offlineFriends = friends.filter((f) => f.currentGame === null);

  const panel = isOpen ? (
    <div
      ref={panelRef}
      className="friends-dropdown__panel"
      style={{ top: panelPosition.y, left: panelPosition.x }}
    >
      <div className="friends-dropdown__header">
        <span className="friends-dropdown__title">{t("friends")}</span>
        <span className="friends-dropdown__count">{totalFriends}</span>
      </div>

      <div
        ref={listRef}
        className="friends-dropdown__list"
        onScroll={handleScroll}
      >
        {friends.length === 0 && !isLoading && (
          <div className="friends-dropdown__empty">{t("no_friends_yet")}</div>
        )}

        {onlineFriends.length > 0 && (
          <>
            <div className="friends-dropdown__section-label">
              {t("online")} ({onlineFriends.length})
            </div>
            {onlineFriends.map((friend) => (
              <button
                type="button"
                key={friend.id}
                className="friends-dropdown__item"
                onClick={() => handleFriendClick(friend.id)}
              >
                <div className="friends-dropdown__avatar-wrapper">
                  <Avatar
                    size={32}
                    src={friend.profileImageUrl}
                    alt={friend.displayName}
                  />
                  <span className="friends-dropdown__online-indicator" />
                </div>
                <div className="friends-dropdown__info">
                  <span className="friends-dropdown__name">
                    {friend.displayName}
                  </span>
                  <span className="friends-dropdown__game">
                    {friend.currentGame!.title}
                  </span>
                </div>
              </button>
            ))}
          </>
        )}

        {offlineFriends.length > 0 && (
          <>
            <div className="friends-dropdown__section-label">
              {t("offline")} ({offlineFriends.length})
            </div>
            {offlineFriends.map((friend) => (
              <button
                type="button"
                key={friend.id}
                className="friends-dropdown__item"
                onClick={() => handleFriendClick(friend.id)}
              >
                <div className="friends-dropdown__avatar-wrapper friends-dropdown__avatar-wrapper--offline">
                  <Avatar
                    size={32}
                    src={friend.profileImageUrl}
                    alt={friend.displayName}
                  />
                </div>
                <div className="friends-dropdown__info">
                  <span className="friends-dropdown__name">
                    {friend.displayName}
                  </span>
                  <span className="friends-dropdown__status">
                    {t("offline")}
                  </span>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="friends-dropdown__trigger"
        onClick={handleToggle}
      >
        <PeopleIcon size={16} />
        {onlineFriends.length > 0 && (
          <span className="friends-dropdown__badge" />
        )}
      </button>

      {panel && createPortal(panel, document.body)}
    </>
  );
}
