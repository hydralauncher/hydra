import { useEffect, useState } from "react";
import cn from "classnames";
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
import { RankDelta } from "./leaderboard-bits";
import { LeaderboardPodium } from "./leaderboard-podium";
import {
  ReportCheaterButton,
  ReportCheaterModal,
  type ReportBoardContext,
} from "./report-cheater";

export interface BoardViewProps {
  leaderboard: GlobalLeaderboard;
  viewerUser: LeaderboardUser | null;
  formatValue: (value: number) => string;
  showDelta: boolean;
  isLoading?: boolean;
  selectedId?: string | null;
  onSelect?: (entry: LeaderboardEntry) => void;
  renderTooltip?: (entry: LeaderboardEntry) => React.ReactNode;
  // Below the podium, like the selected review.
  belowPodium?: React.ReactNode;
  metricColumn: string;
  // Shows "report as cheater" on other users' entries when signed in.
  reportContext?: ReportBoardContext | null;
}

export function BoardView({
  leaderboard,
  viewerUser,
  formatValue,
  showDelta,
  isLoading = false,
  selectedId,
  onSelect,
  renderTooltip,
  belowPodium,
  metricColumn,
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

  const getPreviousRank = (entry: LeaderboardEntry) => {
    const listed = leaderboard.extras[entry.user.id]?.previousRank;
    if (listed !== null && listed !== undefined) return listed;

    return entry.user.id === viewerUser?.id
      ? leaderboard.viewerPreviousRank
      : null;
  };

  const getDelta = (entry: LeaderboardEntry) =>
    showDelta ? getRankDelta(entry.rank, getPreviousRank(entry)) : null;

  // The API does not send the previous rank yet, and an empty column says nothing.
  const showDeltaColumn =
    showDelta && leaderboard.entries.some((entry) => getDelta(entry) !== null);

  const allRows = buildLeaderboardRows(leaderboard, viewerUser, visible);
  const listedCount = Math.min(visible, leaderboard.entries.length);
  const rows = getRowsBelowPodium(allRows, listedCount);
  const hasMore = leaderboard.entries.length > visible;

  return (
    <>
      <LeaderboardPodium
        entries={leaderboard.entries.slice(0, GLOBAL_LEADERBOARD_PODIUM_SIZE)}
        viewerId={viewerUser?.id ?? null}
        formatValue={formatValue}
        getDelta={getDelta}
        selectedId={selectedId}
        onSelect={onSelect}
        renderAction={renderReport}
      />

      {belowPodium}

      {rows.length > 0 && (
        <div className="leaderboards__table">
          <div
            className={cn("leaderboards__table-header", {
              "leaderboards__table-header--with-action": canReport,
            })}
          >
            <span className="leaderboards__table-rank">
              {t("column_position")}
            </span>
            <span className="leaderboards__table-player">
              {t("column_player")}
            </span>
            {showDeltaColumn && (
              <span className="leaderboards__table-delta">
                {t("column_change")}
              </span>
            )}
            <span className="leaderboards__table-value">{metricColumn}</span>
          </div>
          <ol className="leaderboards__list" aria-busy={isLoading}>
            {rows.map((row) => (
              <LeaderboardRow
                key={row.entry.user.id}
                row={row}
                value={formatValue(row.entry.value)}
                showProgress={false}
                strip
                isTableRow
                deltaColumn={
                  showDeltaColumn ? (
                    <RankDelta delta={getDelta(row.entry)} />
                  ) : undefined
                }
                tooltip={renderTooltip?.(row.entry)}
                action={renderReport(row.entry)}
                reserveAction={canReport}
              />
            ))}
          </ol>
        </div>
      )}

      {hasMore && (
        <div className="leaderboards__more">
          <Button
            theme="outline"
            onClick={() =>
              setVisible((value) => value + GLOBAL_LEADERBOARD_PAGE_STEP)
            }
          >
            {t("load_more")}
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
