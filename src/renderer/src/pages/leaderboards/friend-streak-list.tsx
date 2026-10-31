import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import cn from "classnames";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import type { FriendStreak } from "./global-leaderboard";
import { FriendStreakCard } from "./friend-streak-card";

export const FRIEND_STREAK_PAGE_SIZE = 6;

// Below this distance from the end, the list counts as scrolled to the bottom.
const SCROLL_END_TOLERANCE_PX = 1;

export function FriendStreakList({
  friends,
}: Readonly<{ friends: FriendStreak[] }>) {
  const { t } = useTranslation("leaderboards");
  const listRef = useRef<HTMLDivElement>(null);
  const firstNewRowRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(FRIEND_STREAK_PAGE_SIZE);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  const updateHasMoreBelow = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    setHasMoreBelow(
      list.scrollHeight - list.scrollTop - list.clientHeight >
        SCROLL_END_TOLERANCE_PX
    );
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    updateHasMoreBelow();

    const observer = new ResizeObserver(updateHasMoreBelow);
    observer.observe(list);
    return () => observer.disconnect();
  }, [friends.length, updateHasMoreBelow, visible]);

  // Runs after the new rows are in the list, so the first one has a position.
  useEffect(() => {
    const firstNewRow = firstNewRowRef.current;
    if (firstNewRow === null) return;
    firstNewRowRef.current = null;

    const row = listRef.current?.children[firstNewRow];
    if (row instanceof HTMLElement) {
      listRef.current?.scrollTo({ top: row.offsetTop });
    }
  }, [visible]);

  const showMore = () => {
    firstNewRowRef.current = visible;
    setVisible(visible + FRIEND_STREAK_PAGE_SIZE);
  };

  return (
    <div
      ref={listRef}
      className={cn("leaderboards__friend-streaks", {
        "leaderboards__friend-streaks--more-below": hasMoreBelow,
      })}
      onScroll={updateHasMoreBelow}
    >
      {friends.slice(0, visible).map((item) => (
        <FriendStreakCard key={item.user.id} item={item} />
      ))}
      {friends.length > visible && (
        <div className="leaderboards__more">
          <Button theme="outline" onClick={showMore}>
            {t("show_more")}
          </Button>
        </div>
      )}
    </div>
  );
}
