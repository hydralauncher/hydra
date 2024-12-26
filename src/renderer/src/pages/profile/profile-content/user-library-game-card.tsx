import { UserGame } from "@types";
import * as styles from "./profile-content.css";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useFormat } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { useCallback, useContext, useEffect, useState } from "react";
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
}

export function UserLibraryGameCard({ game }: UserLibraryGameCardProps) {
  const { userProfile } = useContext(userProfileContext);
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();
  const navigate = useNavigate();

  const [mediaIndex, setMediaIndex] = useState(0);

  const statsItemCount =
    Number(Boolean(game.achievementsPointsEarnedSum)) +
    Number(Boolean(game.unlockedAchievementCount));

  console.log(game.title, statsItemCount);

  useEffect(() => {
    if (statsItemCount <= 1) return;

    let zero = performance.now();
    const animation = requestAnimationFrame(function animateClosing(time) {
      if (time - zero <= 4000) {
        requestAnimationFrame(animateClosing);
      } else {
        setMediaIndex((index) => {
          if (index === statsItemCount - 1) return 0;
          return index + 1;
        });
        zero = performance.now();
        requestAnimationFrame(animateClosing);
      }
    });

    return () => {
      cancelAnimationFrame(animation);
    };
  }, [setMediaIndex, statsItemCount]);

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
      key={game.objectId}
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
              "linear-gradient(0deg, rgba(0, 0, 0, 0.75) 25%, transparent 100%)",
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
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  transition: "translate 0.5s ease-in-out",
                  flexShrink: "0",
                  flexGrow: "0",
                  translate: `${-100 * mediaIndex}%`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 8,
                    color: vars.color.muted,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <TrophyIcon size={13} />
                    <span>
                      {game.unlockedAchievementCount} / {game.achievementCount}
                    </span>
                  </div>

                  <span>
                    {formatDownloadProgress(
                      game.unlockedAchievementCount / game.achievementCount
                    )}
                  </span>
                </div>

                <progress
                  max={1}
                  value={game.unlockedAchievementCount / game.achievementCount}
                  className={styles.achievementsProgressBar}
                />
              </div>

              {game.achievementsPointsEarnedSum > 0 && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "start",
                    gap: 8,
                    width: "100%",
                    translate: `${-100 * mediaIndex}%`,
                    transition: "translate 0.5s ease-in-out",
                    alignItems: "center",
                    color: vars.color.muted,
                    flexShrink: "0",
                    flexGrow: "0",
                  }}
                >
                  <HydraIcon width={16} height={16} />
                  {numberFormatter.format(game.achievementsPointsEarnedSum)}
                </div>
              )}
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
