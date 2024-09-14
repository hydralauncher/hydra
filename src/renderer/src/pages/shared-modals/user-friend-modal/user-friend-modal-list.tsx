import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { UserFriend } from "@types";
import { useEffect, useRef, useState } from "react";
import { UserFriendItem } from "./user-friend-item";
import { useNavigate } from "react-router-dom";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

export interface UserFriendModalListProps {
  userId: string;
  closeModal: () => void;
}

const pageSize = 12;

export const UserFriendModalList = ({
  userId,
  closeModal,
}: UserFriendModalListProps) => {
  const { t } = useTranslation("user_profile");
  const { showErrorToast } = useToast();
  const navigate = useNavigate();

  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [maxPage, setMaxPage] = useState(0);
  const [friends, setFriends] = useState<UserFriend[]>([]);
  const listContainer = useRef<HTMLDivElement>(null);

  const { userDetails, undoFriendship } = useUserDetails();
  const isMe = userDetails?.id == userId;

  const loadNextPage = () => {
    if (page > maxPage) return;
    setIsLoading(true);
    window.electron
      .getUserFriends(userId, pageSize, page * pageSize)
      .then((newPage) => {
        if (page === 0) {
          setMaxPage(newPage.totalFriends / pageSize);
        }

        setFriends([...friends, ...newPage.friends]);
        setPage(page + 1);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  };

  const handleScroll = () => {
    const scrollTop = listContainer.current?.scrollTop || 0;
    const scrollHeight = listContainer.current?.scrollHeight || 0;
    const clientHeight = listContainer.current?.clientHeight || 0;
    const maxScrollTop = scrollHeight - clientHeight;

    if (scrollTop < maxScrollTop * 0.9 || isLoading) {
      return;
    }

    loadNextPage();
  };

  useEffect(() => {
    const container = listContainer.current;
    container?.addEventListener("scroll", handleScroll);
    return () => container?.removeEventListener("scroll", handleScroll);
  }, [isLoading]);

  const reloadList = () => {
    setPage(0);
    setMaxPage(0);
    setFriends([]);
    loadNextPage();
  };

  useEffect(() => {
    reloadList();
  }, [userId]);

  const handleClickFriend = (userId: string) => {
    closeModal();
    navigate(`/profile/${userId}`);
  };

  const handleUndoFriendship = (userId: string) => {
    undoFriendship(userId)
      .then(() => {
        reloadList();
      })
      .catch(() => {
        showErrorToast(t("try_again"));
      });
  };

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <div
        ref={listContainer}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: `${SPACING_UNIT * 2}px`,
          maxHeight: "400px",
          overflowY: "scroll",
        }}
      >
        {!isLoading && friends.length === 0 && <p>{t("no_friends_added")}</p>}
        {friends.map((friend) => {
          return (
            <UserFriendItem
              userId={friend.id}
              displayName={friend.displayName}
              profileImageUrl={friend.profileImageUrl}
              onClickItem={handleClickFriend}
              onClickUndoFriendship={handleUndoFriendship}
              type={isMe ? "ACCEPTED" : null}
              key={"modal" + friend.id}
            />
          );
        })}
        {isLoading && (
          <Skeleton
            style={{
              width: "100%",
              height: "54px",
              overflow: "hidden",
              borderRadius: "4px",
            }}
          />
        )}
      </div>
    </SkeletonTheme>
  );
};
