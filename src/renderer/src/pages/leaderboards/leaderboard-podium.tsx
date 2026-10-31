import cn from "classnames";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Avatar, getRankTier } from "@renderer/components";
import { LEADERBOARD_PODIUM_BANNER_IMAGE_SIZE } from "@renderer/constants";
import { useProcessedImage } from "@renderer/hooks";
import type { LeaderboardEntry } from "../game-details/leaderboard/game-leaderboard";
import { RankDelta } from "./leaderboard-bits";

export interface LeaderboardPodiumProps {
  entries: LeaderboardEntry[];
  viewerId: string | null;
  formatValue: (value: number) => string;
  getDelta?: (entry: LeaderboardEntry) => number | null;
  selectedId?: string | null;
  onSelect?: (entry: LeaderboardEntry) => void;
  renderAction?: (entry: LeaderboardEntry) => React.ReactNode;
}

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
  formatValue,
  getDelta,
  selectedId,
  onSelect,
  renderAction,
}: Readonly<LeaderboardPodiumProps>) {
  const { t } = useTranslation("leaderboards");
  const { t: tLeaderboard } = useTranslation("leaderboard");
  const navigate = useNavigate();

  return (
    <div className="leaderboard-podium-wrapper">
      <div
        className={cn("leaderboard-podium", {
          "leaderboard-podium--sparse": entries.length < 3,
        })}
        style={{ "--podium-count": entries.length } as React.CSSProperties}
      >
        {entries.map((entry) => {
          const tier = getRankTier(entry.rank);
          const isViewer = entry.user.id === viewerId;
          const action = renderAction?.(entry);

          return (
            <div key={entry.user.id} className="leaderboard-podium__slot">
              <button
                type="button"
                className={cn(
                  "leaderboard-podium__card",
                  `leaderboard-podium__card--${tier}`,
                  {
                    "leaderboard-podium__card--viewer": isViewer,
                    "leaderboard-podium__card--selected":
                      onSelect && selectedId === entry.user.id,
                  }
                )}
                onClick={() =>
                  onSelect
                    ? onSelect(entry)
                    : navigate(`/profile/${entry.user.id}`)
                }
                aria-pressed={
                  onSelect ? selectedId === entry.user.id : undefined
                }
                aria-current={isViewer ? "true" : undefined}
              >
                <span
                  className={`leaderboard-podium__band leaderboard-row__strip--${tier}`}
                  role="img"
                  aria-label={tLeaderboard(`medal_${tier}`, {
                    rank: entry.rank,
                  })}
                >
                  <span className="leaderboard-podium__rank">{entry.rank}</span>
                  <span className="leaderboard-podium__metal">
                    {t(`metal_${tier}`)}
                  </span>
                </span>

                <PodiumBody bannerUrl={entry.user.backgroundImageUrl}>
                  <span className="leaderboard-podium__avatar-wrapper">
                    <Avatar
                      size={entry.rank === 1 ? 64 : 56}
                      src={entry.user.profileImageUrl}
                      alt={entry.user.displayName}
                      className="leaderboard-podium__avatar"
                    />
                    {isViewer && (
                      <span className="leaderboard-podium__you">
                        {tLeaderboard("you")}
                      </span>
                    )}
                  </span>

                  <span className="leaderboard-podium__name">
                    {entry.user.displayName}
                  </span>

                  <span className="leaderboard-podium__value">
                    {formatValue(entry.value)}
                    {entry.rank > 1 && (
                      <RankDelta delta={getDelta?.(entry) ?? null} />
                    )}
                  </span>
                </PodiumBody>
              </button>
              {action && (
                <span className="leaderboard-podium__action">{action}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
