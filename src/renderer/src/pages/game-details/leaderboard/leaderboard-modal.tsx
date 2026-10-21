import { useEffect, useMemo, useState } from "react";
import { SearchIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import {
  buildLeaderboardRows,
  filterLeaderboardEntries,
  findViewerEntry,
  LEADERBOARD_TAKE,
  type Leaderboard,
  type LeaderboardMetric,
  type LeaderboardUser,
} from "./game-leaderboard";
import { LeaderboardRow } from "./leaderboard-row";

export const LEADERBOARD_MODAL_PAGE_SIZE = 20;

export interface LeaderboardModalProps {
  visible: boolean;
  onClose: () => void;
  gameTitle: string;
  leaderboard: Leaderboard;
  viewerUser: LeaderboardUser | null;
  isLoading: boolean;
  controls: React.ReactNode;
  metric: LeaderboardMetric;
  formatValue: (metric: LeaderboardMetric, value: number) => string;
}

export function LeaderboardModal({
  visible,
  onClose,
  gameTitle,
  leaderboard,
  viewerUser,
  isLoading,
  controls,
  metric,
  formatValue,
}: Readonly<LeaderboardModalProps>) {
  const { t } = useTranslation("leaderboard");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(LEADERBOARD_MODAL_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(LEADERBOARD_MODAL_PAGE_SIZE);
  }, [search, leaderboard]);

  useEffect(() => {
    if (!visible) setSearch("");
  }, [visible]);

  const allRows = useMemo(
    () =>
      buildLeaderboardRows(
        { entries: leaderboard.entries, viewer: null },
        viewerUser,
        leaderboard.entries.length
      ),
    [leaderboard.entries, viewerUser]
  );

  const filteredRows = useMemo(() => {
    const matches = new Set(
      filterLeaderboardEntries(leaderboard.entries, search).map(
        (entry) => entry.user.id
      )
    );

    return allRows.filter((row) => matches.has(row.entry.user.id));
  }, [allRows, leaderboard.entries, search]);

  const viewerEntry = findViewerEntry(leaderboard, viewerUser);
  const shownRows = filteredRows.slice(0, visibleCount);
  const playerCount = leaderboard.entries.length;

  return (
    <Modal
      visible={visible}
      title={t("modal_title", { game: gameTitle })}
      description={t("players_count", {
        count: playerCount,
        amount:
          playerCount >= LEADERBOARD_TAKE
            ? `${LEADERBOARD_TAKE}+`
            : playerCount,
      })}
      onClose={onClose}
      large
    >
      <div className="leaderboard-modal" aria-busy={isLoading}>
        <div className="leaderboard-modal__toolbar">
          <TextField
            theme="dark"
            value={search}
            placeholder={t("search_player")}
            aria-label={t("search_player")}
            onChange={(event) => setSearch(event.target.value)}
            rightContent={<SearchIcon size={16} />}
          />
          {controls}
        </div>

        {shownRows.length === 0 ? (
          <p className="leaderboard-modal__empty">{t("search_empty")}</p>
        ) : (
          <ol className="leaderboard-modal__list">
            {shownRows.map((row) => (
              <LeaderboardRow
                key={row.entry.user.id}
                row={row}
                value={formatValue(metric, row.entry.value)}
              />
            ))}
          </ol>
        )}

        {filteredRows.length > shownRows.length && (
          <div className="leaderboard-modal__more">
            <Button
              theme="outline"
              size="small"
              onClick={() =>
                setVisibleCount((count) => count + LEADERBOARD_MODAL_PAGE_SIZE)
              }
            >
              {t("show_more")}
            </Button>
          </div>
        )}

        {viewerEntry && (
          <div className="leaderboard-modal__viewer">
            <span className="leaderboard-modal__viewer-label">
              {t("your_position")}
            </span>
            <ol className="leaderboard-modal__list">
              <LeaderboardRow
                row={{
                  entry: viewerEntry,
                  isViewer: true,
                  gapBefore: false,
                  progress: 0,
                }}
                value={formatValue(metric, viewerEntry.value)}
                showProgress={false}
              />
            </ol>
          </div>
        )}
      </div>
    </Modal>
  );
}
