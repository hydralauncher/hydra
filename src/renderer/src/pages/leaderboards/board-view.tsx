import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import { useFeature } from "@renderer/hooks";
import {
  buildLeaderboardRows,
  type LeaderboardEntry,
  type LeaderboardUser,
} from "../game-details/leaderboard/game-leaderboard";
import { LeaderboardRow } from "../game-details/leaderboard/leaderboard-row";
import {
  getRankDelta,
  getRowsBelowPodium,
  GLOBAL_LEADERBOARD_PAGE_SIZE,
  GLOBAL_LEADERBOARD_PAGE_STEP,
  GLOBAL_LEADERBOARD_PODIUM_SIZE,
  type GlobalLeaderboard,
} from "./global-leaderboard";
import { RankDelta, StreakFlame } from "./leaderboard-bits";
import { LeaderboardPodium, type StreakStatus } from "./leaderboard-podium";
import {
  ReportCheaterButton,
  ReportCheaterModal,
  type ReportBoardContext,
} from "./report-cheater";

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
  onVisibleChange?: (visible: number) => void;
  // Shows "report as cheater" on other users' entries when signed in.
  reportContext?: ReportBoardContext | null;
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
  onVisibleChange,
  reportContext = null,
}: Readonly<BoardViewProps>) {
  const { t } = useTranslation("leaderboards");
  const [visible, setVisible] = useState(GLOBAL_LEADERBOARD_PAGE_SIZE);
  const [reported, setReported] = useState<LeaderboardEntry | null>(null);
  const { isFeatureEnabled, Feature } = useFeature();
  // Behind a flag until the API accepts the "cheating" reason
  // (hydralauncher/hydra-api#881).
  const canReport = Boolean(
    reportContext && viewerUser && isFeatureEnabled(Feature.LeaderboardReports)
  );

  const renderReport = (entry: LeaderboardEntry) =>
    canReport && entry.user.id !== viewerUser?.id ? (
      <ReportCheaterButton entry={entry} onReport={setReported} />
    ) : null;

  useEffect(() => {
    setVisible(GLOBAL_LEADERBOARD_PAGE_SIZE);
  }, [leaderboard]);

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [onVisibleChange, visible]);

  const getPreviousRank = (entry: LeaderboardEntry) => {
    const listed = leaderboard.extras[entry.user.id]?.previousRank;
    if (listed !== null && listed !== undefined) return listed;

    return entry.user.id === viewerUser?.id
      ? leaderboard.viewerPreviousRank
      : null;
  };

  const getDelta = (entry: LeaderboardEntry) =>
    showDelta ? getRankDelta(entry.rank, getPreviousRank(entry)) : null;

  const getStreak = (entry: LeaderboardEntry): StreakStatus => {
    if (!isStreak) return null;
    const active = leaderboard.extras[entry.user.id]?.streakActive;
    if (active === null || active === undefined) return null;

    return active ? "active" : "ended";
  };

  const allRows = buildLeaderboardRows(leaderboard, viewerUser, visible);
  const listedCount = Math.min(visible, leaderboard.entries.length);
  const rows = getRowsBelowPodium(allRows, listedCount);
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
        renderAction={renderReport}
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
                action={renderReport(row.entry)}
                reserveAction={canReport}
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

      {reportContext && (
        <ReportCheaterModal
          entry={reported}
          context={reportContext}
          formatValue={formatValue}
          onClose={() => setReported(null)}
        />
      )}
    </>
  );
}
