import cn from "classnames";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  Avatar,
  getRankTier,
  isMedalTier,
  RankFrameRing,
  RankMedal,
} from "@renderer/components";
import { LEADERBOARD_ROW_BANNER_IMAGE_SIZE } from "@renderer/constants";
import { useProcessedImage } from "@renderer/hooks";
import type { LeaderboardRow as LeaderboardRowData } from "./game-leaderboard";

export interface LeaderboardRowProps {
  row: LeaderboardRowData;
  value: string;
  showProgress?: boolean;
  rankAddon?: React.ReactNode;
  valuePrefix?: React.ReactNode;
  valueMuted?: boolean;
  tooltip?: React.ReactNode;
}

export function LeaderboardRow({
  row,
  value,
  showProgress = true,
  rankAddon,
  valuePrefix,
  valueMuted = false,
  tooltip,
}: Readonly<LeaderboardRowProps>) {
  const { t } = useTranslation("leaderboard");
  const navigate = useNavigate();
  const { entry, isViewer, gapBefore, progress } = row;
  const tier = getRankTier(entry.rank);
  const banner = useProcessedImage(
    entry.user.backgroundImageUrl,
    LEADERBOARD_ROW_BANNER_IMAGE_SIZE
  );

  return (
    <li
      className={cn("leaderboard-row__item", {
        "leaderboard-row__item--tooltip": tooltip,
      })}
    >
      {tooltip && (
        <div className="leaderboard-row__tooltip" role="tooltip">
          {tooltip}
        </div>
      )}

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
        {isMedalTier(tier) && <RankFrameRing />}
        <span className="leaderboard-row__rank">
          <RankMedal rank={entry.rank} highlighted={isViewer} />
          {rankAddon}
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

        <span
          className={cn("leaderboard-row__value", {
            "leaderboard-row__value--muted": valueMuted,
          })}
        >
          {valuePrefix}
          {value}
        </span>
      </button>
    </li>
  );
}
