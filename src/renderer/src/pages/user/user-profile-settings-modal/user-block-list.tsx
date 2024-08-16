import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { UserFriend } from "@types";
import { useEffect, useRef, useState } from "react";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { UserFriendItem } from "@renderer/pages/shared-modals/user-friend-modal/user-friend-item";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

const pageSize = 12;

export const UserEditProfileBlockList = () => {
  const { t } = useTranslation("user_profile");
  const { showErrorToast } = useToast();

  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [maxPage, setMaxPage] = useState(0);
  const [blocks, setBlocks] = useState<UserFriend[]>([]);
  const listContainer = useRef<HTMLDivElement>(null);

  const { unblockUser } = useUserDetails();

  const loadNextPage = () => {
    if (page > maxPage) return;
    setIsLoading(true);
    window.electron
      .getUserBlocks(pageSize, page * pageSize)
      .then((newPage) => {
        if (page === 0) {
          setMaxPage(newPage.totalBlocks / pageSize);
        }

        setBlocks([...blocks, ...newPage.blocks]);
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
    listContainer.current?.addEventListener("scroll", handleScroll);
    return () =>
      listContainer.current?.removeEventListener("scroll", handleScroll);
  }, [isLoading]);

  const reloadList = () => {
    setPage(0);
    setMaxPage(0);
    setBlocks([]);
    loadNextPage();
  };

  useEffect(() => {
    reloadList();
  }, []);

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
        {!isLoading && blocks.length === 0 && <p>{t("no_blocked_users")}</p>}
        {blocks.map((friend) => {
          return (
            <UserFriendItem
              userId={friend.id}
              displayName={friend.displayName}
              profileImageUrl={friend.profileImageUrl}
              onClickUnblock={handleUnblock}
              type={"BLOCKED"}
              key={friend.id}
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
