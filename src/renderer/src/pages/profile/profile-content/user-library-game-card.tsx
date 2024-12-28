import { UserGame } from "@types";
import * as styles from "./profile-content.css";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useFormat } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { useCallback, useContext } from "react";
import {
  buildGameAchievementPath,
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";
import { userProfileContext } from "@renderer/context";
import { vars } from "@renderer/theme.css";
import { ClockIcon, TrophyIcon } from "@primer/octicons-react";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { useTranslation } from "react-i18next";
import { steamUrlBuilder } from "@shared";

interface UserLibraryGameCardProps {
  game: UserGame;
  statIndex: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function UserLibraryGameCard({
  game,
  statIndex,
  onMouseEnter,
  onMouseLeave,
}: UserLibraryGameCardProps) {
  const { userProfile } = useContext(userProfileContext);
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();

  const getStatsItemCount = useCallback(() => {
    let statsCount = 1;
    if (game.achievementsPointsEarnedSum > 0) statsCount++;
    return statsCount;
  }, [game]);

  const buildUserGameDetailsPath = useCallback(
    (game: UserGame) => {
      if (!userProfile?.hasActiveSubscription || game.achievementCount === 0) {
        return buildGameDetailsPath({
          ...game,
          objectId: game.objectId,
        });
      }

      const userParams = userProfile
        ? {
            userId: userProfile.id,
          }
        : undefined;

      return buildGameAchievementPath({ ...game }, userParams);
    },
    [userProfile]
  );

  const formatAchievementPoints = (number: number) => {
    if (number < 100_000) return numberFormatter.format(number);

    if (number < 1_000_000) return `${(number / 1000).toFixed(1)}K`;

    return `${(number / 1_000_000).toFixed(1)}M`;
  };

  const formatPlayTime = useCallback(
    (playTimeInSeconds = 0) => {
      const minutes = playTimeInSeconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      return t("amount_hours", { amount: numberFormatter.format(hours) });
    },
    [numberFormatter, t]
  );

  return (
    <li
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        borderRadius: 4,
        overflow: "hidden",
        position: "relative",
        display: "flex",
      }}
      title={game.title}
      className={styles.game}
    >
      <button
        type="button"
        style={{
          cursor: "pointer",
        }}
        className={styles.gameCover}
        onClick={() => navigate(buildUserGameDetailsPath(game))}
      >
        <div
          style={{
            position: "absolute",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "space-between",
            height: "100%",
            width: "100%",
            background:
              "linear-gradient(0deg, rgba(0, 0, 0, 0.70) 20%, transparent 100%)",
            padding: 8,
          }}
        >
          <small
            style={{
              backgroundColor: vars.color.background,
              color: vars.color.muted,
              border: `solid 1px ${vars.color.border}`,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "4px",
            }}
          >
            <ClockIcon size={11} />
            {formatPlayTime(game.playTimeInSeconds)}
          </small>

          {userProfile?.hasActiveSubscription && game.achievementCount > 0 && (
            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: 8,
                  color: vars.color.muted,
                  overflow: "hidden",
                  height: 18,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    className={styles.gameCardStats}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      transform: `translateY(${-100 * (statIndex % getStatsItemCount())}%)`,
                    }}
                  >
                    <TrophyIcon size={13} />
                    <span>
                      {game.unlockedAchievementCount} / {game.achievementCount}
                    </span>
                  </div>

                  {game.achievementsPointsEarnedSum > 0 && (
                    <div
                      className={styles.gameCardStats}
                      style={{
                        display: "flex",
                        gap: 5,
                        transform: `translateY(${-100 * (statIndex % getStatsItemCount())}%)`,
                        alignItems: "center",
                      }}
                    >
                      <HydraIcon width={16} height={16} />
                      {formatAchievementPoints(
                        game.achievementsPointsEarnedSum
                      )}
                    </div>
                  )}
                </div>

                <span>
                  {formatDownloadProgress(
                    game.unlockedAchievementCount / game.achievementCount,
                    1
                  )}
                </span>
              </div>

              <progress
                max={1}
                value={game.unlockedAchievementCount / game.achievementCount}
                className={styles.achievementsProgressBar}
              />
            </div>
          )}
        </div>

        <img
          src={steamUrlBuilder.cover(game.objectId)}
          alt={game.title}
          style={{
            objectFit: "cover",
            borderRadius: 4,
            width: "100%",
            height: "100%",
            minWidth: "100%",
            minHeight: "100%",
          }}
        />
      </button>
    </li>
  );
}
