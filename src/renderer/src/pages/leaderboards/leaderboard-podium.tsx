import cn from "classnames";
import { TrophyIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Avatar, getRankTier } from "@renderer/components";
import { LEADERBOARD_PODIUM_BANNER_IMAGE_SIZE } from "@renderer/constants";
import { useProcessedImage } from "@renderer/hooks";
import type { LeaderboardEntry } from "../game-details/leaderboard/game-leaderboard";
import { RankDelta, StreakFlame } from "./leaderboard-bits";

export type StreakStatus = "active" | "ended" | null;

export interface LeaderboardPodiumProps {
  entries: LeaderboardEntry[];
  viewerId: string | null;
  leaderLabel: string;
  formatValue: (value: number) => string;
  getDelta?: (entry: LeaderboardEntry) => number | null;
  getStreak?: (entry: LeaderboardEntry) => StreakStatus;
  selectedId?: string | null;
  onSelect?: (entry: LeaderboardEntry) => void;
  renderAction?: (entry: LeaderboardEntry) => React.ReactNode;
}

const PODIUM_ORDER = [1, 0, 2];

function PodiumBody({
  bannerUrl,
  children,
}: Readonly<{ bannerUrl: string | null; children: React.ReactNode }>) {
  const banner = useProcessedImage(
    bannerUrl,
    LEADERBOARD_PODIUM_BANNER_IMAGE_SIZE
  );

  return (
    <span
      className={cn("leaderboard-podium__body", {
        "leaderboard-podium__body--banner": banner,
      })}
      style={
        banner
          ? ({
              "--leaderboard-podium-banner": `url(${JSON.stringify(banner)})`,
            } as React.CSSProperties)
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function LeaderboardPodium({
  entries,
  viewerId,
  leaderLabel,
  formatValue,
  getDelta,
  getStreak,
  selectedId,
  onSelect,
  renderAction,
}: Readonly<LeaderboardPodiumProps>) {
  const { t } = useTranslation("leaderboards");
  const { t: tLeaderboard } = useTranslation("leaderboard");
  const navigate = useNavigate();

  const ordered = PODIUM_ORDER.flatMap((index) =>
    entries[index] ? [entries[index]] : []
  );

  return (
    <div
      className={cn("leaderboard-podium", {
        "leaderboard-podium--sparse": ordered.length < PODIUM_ORDER.length,
      })}
      style={{ "--podium-count": ordered.length } as React.CSSProperties}
    >
      {ordered.map((entry) => {
        const tier = getRankTier(entry.rank);
        const isViewer = entry.user.id === viewerId;
        const streak = getStreak?.(entry) ?? null;
        const action = renderAction?.(entry);

        return (
          <div key={entry.user.id} className="leaderboard-podium__slot">
            <button
              type="button"
              className={cn(
                "leaderboard-podium__card",
                `leaderboard-podium__card--${tier}`,
                {
                  "leaderboard-podium__card--selected":
                    onSelect && selectedId === entry.user.id,
                }
              )}
              onClick={() =>
                onSelect
                  ? onSelect(entry)
                  : navigate(`/profile/${entry.user.id}`)
              }
              aria-pressed={onSelect ? selectedId === entry.user.id : undefined}
              aria-current={isViewer ? "true" : undefined}
            >
              <span
                className="leaderboard-podium__band"
                role="img"
                aria-label={tLeaderboard(`medal_${tier}`, { rank: entry.rank })}
              >
                <span className="leaderboard-podium__rank">{entry.rank}</span>
                <span className="leaderboard-podium__metal">
                  {t(`metal_${tier}`)}
                </span>
              </span>

              <PodiumBody bannerUrl={entry.user.backgroundImageUrl}>
                <Avatar
                  size={entry.rank === 1 ? 64 : 52}
                  src={entry.user.profileImageUrl}
                  alt={entry.user.displayName}
                  className="leaderboard-podium__avatar"
                />

                <span className="leaderboard-podium__name-line">
                  <span className="leaderboard-podium__name">
                    {entry.user.displayName}
                  </span>
                  {isViewer && (
                    <span className="leaderboard-podium__you">
                      {tLeaderboard("you")}
                    </span>
                  )}
                </span>

                <span
                  className={cn("leaderboard-podium__value", {
                    "leaderboard-podium__value--muted": streak === "ended",
                  })}
                >
                  {streak === "active" && (
                    <StreakFlame label={t("streak_active")} />
                  )}
                  {formatValue(entry.value)}
                </span>

                {entry.rank === 1 ? (
                  <span className="leaderboard-podium__leader">
                    <TrophyIcon size={14} />
                    {leaderLabel}
                  </span>
                ) : (
                  <span className="leaderboard-podium__foot">
                    <RankDelta delta={getDelta?.(entry) ?? null} />
                  </span>
                )}
              </PodiumBody>
            </button>
            {action && (
              <span className="leaderboard-podium__action">{action}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
