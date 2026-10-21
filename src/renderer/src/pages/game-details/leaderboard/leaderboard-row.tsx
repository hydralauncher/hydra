import cn from "classnames";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  Avatar,
  getRankTier,
  isMedalTier,
  RankMedal,
} from "@renderer/components";
import type { LeaderboardRow as LeaderboardRowData } from "./game-leaderboard";

export interface LeaderboardRowProps {
  row: LeaderboardRowData;
  value: string;
  showProgress?: boolean;
}

export function LeaderboardRow({
  row,
  value,
  showProgress = true,
}: LeaderboardRowProps) {
  const { t } = useTranslation("leaderboard");
  const navigate = useNavigate();
  const { entry, isViewer, gapBefore, progress } = row;
  const tier = getRankTier(entry.rank);
  const banner = entry.user.backgroundImageUrl;

  return (
    <li className="leaderboard-row__item">
      {gapBefore && (
        <div className="leaderboard-row__gap" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}

      <button
        type="button"
        className={cn("leaderboard-row", {
          "leaderboard-row--viewer": isViewer,
          "leaderboard-row--banner": banner,
          [`rank-frame rank-frame--${tier}`]: isMedalTier(tier),
        })}
        style={
          banner
            ? ({
                "--leaderboard-row-banner": `url(${JSON.stringify(banner)})`,
              } as React.CSSProperties)
            : undefined
        }
        onClick={() => navigate(`/profile/${entry.user.id}`)}
        aria-current={isViewer ? "true" : undefined}
      >
        <span className="leaderboard-row__rank">
          <RankMedal rank={entry.rank} highlighted={isViewer} />
        </span>

        <Avatar
          size={36}
          src={entry.user.profileImageUrl}
          alt={entry.user.displayName}
        />

        <span className="leaderboard-row__body">
          <span className="leaderboard-row__name-line">
            <span className="leaderboard-row__name">
              {entry.user.displayName}
            </span>
            {isViewer && (
              <span className="leaderboard-row__you">{t("you")}</span>
            )}
          </span>

          {showProgress && (
            <span className="leaderboard-row__progress" aria-hidden="true">
              <span
                className="leaderboard-row__progress-fill"
                style={{ width: `${progress}%` }}
              />
            </span>
          )}
        </span>

        <span className="leaderboard-row__value">{value}</span>
      </button>
    </li>
  );
}
