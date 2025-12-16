import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { XCircleIcon } from "@primer/octicons-react";
import { Modal, Avatar, Button } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import type { UserFriend } from "@types";
import "./all-friends-modal.scss";

interface AllFriendsModalProps {
  visible: boolean;
  onClose: () => void;
  userId: string;
  isMe: boolean;
}

const PAGE_SIZE = 20;

export function AllFriendsModal({
  visible,
  onClose,
  userId,
  isMe,
}: AllFriendsModalProps) {
  const { t } = useTranslation("user_profile");
  const navigate = useNavigate();
  const { undoFriendship } = useUserDetails();
  const { showSuccessToast, showErrorToast } = useToast();

  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [totalFriends, setTotalFriends] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchFriends = useCallback(
    async (pageNum: number, append = false) => {
      if (isLoading) return;

      setIsLoading(true);
      try {
        const url = isMe ? "/profile/friends" : `/users/${userId}/friends`;
        const response = await window.electron.hydraApi.get<{
          totalFriends: number;
          friends: UserFriend[];
        }>(url, {
          params: { take: PAGE_SIZE, skip: pageNum * PAGE_SIZE },
        });

        if (append) {
          setFriends((prev) => [...prev, ...response.friends]);
        } else {
          setFriends(response.friends);
        }

        setTotalFriends(response.totalFriends);
        setHasMore((pageNum + 1) * PAGE_SIZE < response.totalFriends);
        setPage(pageNum + 1);
      } catch (error) {
        logger.error("Failed to fetch friends", error);
      } finally {
        setIsLoading(false);
      }
    },
    [userId, isMe, isLoading]
  );

  useEffect(() => {
    if (visible) {
      setFriends([]);
      setPage(0);
      setHasMore(true);
      fetchFriends(0, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, userId]);

  const handleScroll = useCallback(() => {
    if (!listRef.current || isLoading || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    if (scrollTop + clientHeight >= scrollHeight - 50) {
      fetchFriends(page, true);
    }
  }, [isLoading, hasMore, page, fetchFriends]);

  const handleFriendClick = (friendId: string) => {
    onClose();
    navigate(`/profile/${friendId}`);
  };

  const handleLoadMore = () => {
    if (!isLoading && hasMore) {
      fetchFriends(page, true);
    }
  };

  const handleRemoveFriend = useCallback(
    async (e: React.MouseEvent, friendId: string) => {
      e.stopPropagation();
      setRemovingId(friendId);

      try {
        await undoFriendship(friendId);
        setFriends((prev) => prev.filter((f) => f.id !== friendId));
        setTotalFriends((prev) => prev - 1);
        showSuccessToast(t("friendship_removed"));
      } catch (error) {
        logger.error("Failed to remove friend", error);
        showErrorToast(t("try_again"));
      } finally {
        setRemovingId(null);
      }
    },
    [undoFriendship, showSuccessToast, showErrorToast, t]
  );

  const getGameImage = (game: { iconUrl: string | null; title: string }) => {
    if (game.iconUrl) {
      return <img alt={game.title} width={16} height={16} src={game.iconUrl} />;
    }
    return <SteamLogo width={16} height={16} />;
  };

  const modalTitle = (
    <div className="all-friends-modal__title">
      {t("friends")}
      {totalFriends > 0 && (
        <span className="all-friends-modal__count">{totalFriends}</span>
      )}
    </div>
  );

  return (
    <Modal visible={visible} title={modalTitle} onClose={onClose}>
      <div className="all-friends-modal">
        {friends.length === 0 && !isLoading ? (
          <div className="all-friends-modal__empty">
            {t("no_friends_added")}
          </div>
        ) : (
          <div
            ref={listRef}
            className="all-friends-modal__list"
            onScroll={handleScroll}
          >
            {friends.map((friend) => (
              <div
                key={friend.id}
                className="all-friends-modal__item"
                onClick={() => handleFriendClick(friend.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    handleFriendClick(friend.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <Avatar
                  size={40}
                  src={friend.profileImageUrl}
                  alt={friend.displayName}
                />
                <div className="all-friends-modal__info">
                  <span className="all-friends-modal__name">
                    {friend.displayName}
                  </span>
                  {friend.currentGame && (
                    <div className="all-friends-modal__game">
                      {getGameImage(friend.currentGame)}
                      <small>{friend.currentGame.title}</small>
                    </div>
                  )}
                </div>
                {isMe && (
                  <button
                    type="button"
                    className="all-friends-modal__remove"
                    onClick={(e) => handleRemoveFriend(e, friend.id)}
                    disabled={removingId === friend.id}
                    title={t("undo_friendship")}
                  >
                    <XCircleIcon size={20} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="all-friends-modal__loading">{t("loading")}...</div>
        )}

        {hasMore && !isLoading && friends.length > 0 && (
          <div className="all-friends-modal__load-more">
            <Button theme="outline" onClick={handleLoadMore}>
              {t("load_more")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
