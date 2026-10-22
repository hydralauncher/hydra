import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import {
  buildLeaderboardRows,
  type LeaderboardEntry,
  type LeaderboardUser,
} from "../game-details/leaderboard/game-leaderboard";
import { LeaderboardRow } from "../game-details/leaderboard/leaderboard-row";
import {
  getRankDelta,
  GLOBAL_LEADERBOARD_PAGE_SIZE,
  GLOBAL_LEADERBOARD_PAGE_STEP,
  GLOBAL_LEADERBOARD_PODIUM_SIZE,
  type GlobalLeaderboard,
} from "./global-leaderboard";
import { RankDelta, StreakFlame } from "./leaderboard-bits";
import { LeaderboardPodium, type StreakStatus } from "./leaderboard-podium";

export interface BoardViewProps {
  leaderboard: GlobalLeaderboard;
  viewerUser: LeaderboardUser | null;
  formatValue: (value: number) => string;
  leaderLabel: string;
  showDelta: boolean;
  isStreak?: boolean;
  isLoading?: boolean;
  selectedId?: string | null;
  onSelect?: (entry: LeaderboardEntry) => void;
  renderTooltip?: (entry: LeaderboardEntry) => React.ReactNode;
  footer?: React.ReactNode;
}

export function BoardView({
  leaderboard,
  viewerUser,
  formatValue,
  leaderLabel,
  showDelta,
  isStreak = false,
  isLoading = false,
  selectedId,
  onSelect,
  renderTooltip,
  footer,
}: BoardViewProps) {
  const { t } = useTranslation("leaderboards");
  const [visible, setVisible] = useState(GLOBAL_LEADERBOARD_PAGE_SIZE);

  useEffect(() => {
    setVisible(GLOBAL_LEADERBOARD_PAGE_SIZE);
  }, [leaderboard]);

  const getDelta = (entry: LeaderboardEntry) =>
    showDelta
      ? getRankDelta(
          entry.rank,
          leaderboard.extras[entry.user.id]?.previousRank ?? null
        )
      : null;

  const getStreak = (entry: LeaderboardEntry): StreakStatus => {
    if (!isStreak) return null;
    const active = leaderboard.extras[entry.user.id]?.streakActive;
    if (active === null || active === undefined) return null;

    return active ? "active" : "ended";
  };

  const rows = buildLeaderboardRows(leaderboard, viewerUser, visible).filter(
    (row) => row.entry.rank > GLOBAL_LEADERBOARD_PODIUM_SIZE
  );
  const hasMore = leaderboard.entries.length > visible;

  return (
    <>
      <LeaderboardPodium
        entries={leaderboard.entries.slice(0, GLOBAL_LEADERBOARD_PODIUM_SIZE)}
        viewerId={viewerUser?.id ?? null}
        leaderLabel={leaderLabel}
        formatValue={formatValue}
        getDelta={getDelta}
        getStreak={getStreak}
        selectedId={selectedId}
        onSelect={onSelect}
      />

      {rows.length > 0 && (
        <ol className="leaderboards__list" aria-busy={isLoading}>
          {rows.map((row) => {
            const streak = getStreak(row.entry);

            return (
              <LeaderboardRow
                key={row.entry.user.id}
                row={row}
                value={formatValue(row.entry.value)}
                rankAddon={
                  showDelta ? <RankDelta delta={getDelta(row.entry)} /> : null
                }
                valuePrefix={
                  streak === "active" ? (
                    <StreakFlame label={t("streak_active")} />
                  ) : null
                }
                valueMuted={streak === "ended"}
                tooltip={renderTooltip?.(row.entry)}
              />
            );
          })}
        </ol>
      )}

      {hasMore && (
        <div className="leaderboards__more">
          <Button
            theme="outline"
            onClick={() =>
              setVisible((value) => value + GLOBAL_LEADERBOARD_PAGE_STEP)
            }
          >
            {t("show_more")}
          </Button>
        </div>
      )}

      {footer}
    </>
  );
}
