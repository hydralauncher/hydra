import { SPACING_UNIT } from "@renderer/theme.css";
import { UserFriend } from "@types";
import { useEffect, useState } from "react";
import { UserFriendItem } from "./user-friend-item";
import { useNavigate } from "react-router-dom";

export interface UserFriendModalListProps {
  userId: string;
  closeModal: () => void;
}

const pageSize = 12;

export const UserFriendModalList = ({
  userId,
  closeModal,
}: UserFriendModalListProps) => {
  const navigate = useNavigate();

  const [page, setPage] = useState(0);
  const [maxPage, setMaxPage] = useState(0);
  const [friends, setFriends] = useState<UserFriend[]>([]);

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

  useEffect(() => {
    setPage(0);
    setMaxPage(0);
    setFriends([]);
    loadNextPage();
  }, [userId]);

  const handleClickFriend = (userId: string) => {
    closeModal();
    navigate(`/user/${userId}`);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: `${SPACING_UNIT * 2}px`,
      }}
    >
      {friends.map((friend) => {
        return (
          <UserFriendItem
            userId={friend.id}
            displayName={friend.displayName}
            profileImageUrl={friend.profileImageUrl}
            onClickAcceptRequest={() => {}}
            onClickCancelRequest={() => {}}
            onClickRefuseRequest={() => {}}
            onClickItem={handleClickFriend}
            type={"ACCEPTED"}
            key={friend.id}
          />
        );
      })}
    </div>
  );
};
