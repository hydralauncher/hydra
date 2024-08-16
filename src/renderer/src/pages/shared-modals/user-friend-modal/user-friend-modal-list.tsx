import { SPACING_UNIT } from "@renderer/theme.css";
import { UserFriend } from "@types";
import { useEffect, useState } from "react";
import { UserFriendItem } from "./user-friend-item";
import { useNavigate } from "react-router-dom";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";

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
  const [maxPage, setMaxPage] = useState(0);
  const [friends, setFriends] = useState<UserFriend[]>([]);

  const { userDetails, undoFriendship } = useUserDetails();
  const isMe = userDetails?.id == userId;

  const loadNextPage = () => {
    if (page > maxPage) return;
    window.electron
      .getUserFriends(userId, pageSize, page * pageSize)
      .then((newPage) => {
        if (page === 0) {
          setMaxPage(newPage.totalFriends / pageSize);
        }

        setFriends([...friends, ...newPage.friends]);
        setPage(page + 1);
      })
      .catch(() => {});
  };

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
    navigate(`/user/${userId}`);
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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: `${SPACING_UNIT * 2}px`,
      }}
    >
      {friends.length === 0 && <p>{t("no_friends_added")}</p>}
      {friends.map((friend) => {
        return (
          <UserFriendItem
            userId={friend.id}
            displayName={friend.displayName}
            profileImageUrl={friend.profileImageUrl}
            onClickItem={handleClickFriend}
            onClickUndoFriendship={handleUndoFriendship}
            type={isMe ? "ACCEPTED" : null}
            key={friend.id}
          />
        );
      })}
    </div>
  );
};
