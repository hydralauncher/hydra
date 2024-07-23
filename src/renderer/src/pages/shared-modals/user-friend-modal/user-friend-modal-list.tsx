import { UserFriend } from "@types";
import { useEffect, useState } from "react";

export interface UserFriendModalListProps {
  userId: string;
}

const pageSize = 12;

export const UserFriendModalList = ({ userId }: UserFriendModalListProps) => {
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

  return friends.map((friend) => {
    return <p key={friend.id}>{friend.displayName}</p>;
  });
};
