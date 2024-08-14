import { SPACING_UNIT } from "@renderer/theme.css";
import { UserFriend } from "@types";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { UserFriendItem } from "@renderer/pages/shared-modals/user-friend-modal/user-friend-item";

export interface UserEditProfileBlockListProps {
  closeModal: () => void;
}

const pageSize = 12;

export const UserEditProfileBlockList = ({
  closeModal,
}: UserEditProfileBlockListProps) => {
  const { t } = useTranslation("user_profile");
  const { showErrorToast } = useToast();
  const navigate = useNavigate();

  const [page, setPage] = useState(0);
  const [maxPage, setMaxPage] = useState(0);
  const [blocks, setBlocks] = useState<UserFriend[]>([]);

  const { unblockUser } = useUserDetails();

  const loadNextPage = () => {
    if (page > maxPage) return;
    window.electron
      .getUserBlocks(pageSize, page * pageSize)
      .then((newPage) => {
        if (page === 0) {
          setMaxPage(newPage.totalBlocks / pageSize);
        }

        setBlocks([...blocks, ...newPage.blocks]);
        setPage(page + 1);
      })
      .catch(() => {});
  };

  const reloadList = () => {
    setPage(0);
    setMaxPage(0);
    setBlocks([]);
    loadNextPage();
  };

  useEffect(() => {
    reloadList();
  }, []);

  const handleClickBlocked = (userId: string) => {
    closeModal();
    navigate(`/user/${userId}`);
  };

  const handleUnblock = (userId: string) => {
    unblockUser(userId)
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
      {blocks.map((friend) => {
        return (
          <UserFriendItem
            userId={friend.id}
            displayName={friend.displayName}
            profileImageUrl={friend.profileImageUrl}
            onClickItem={handleClickBlocked}
            onClickUndoFriendship={handleUnblock}
            type={"ACCEPTED"}
            key={friend.id}
          />
        );
      })}
    </div>
  );
};
