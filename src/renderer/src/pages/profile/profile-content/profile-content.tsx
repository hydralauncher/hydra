import { userProfileContext } from "@renderer/context";
import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ProfileHero } from "../profile-hero/profile-hero";
import { useAppDispatch, useFormat } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { steamUrlBuilder } from "@shared";
import { SPACING_UNIT, vars } from "@renderer/theme.css";

import * as styles from "./profile-content.css";
import { ClockIcon, TelescopeIcon, TrophyIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LockedProfile } from "./locked-profile";
import { ReportProfile } from "../report-profile/report-profile";
import { FriendsBox } from "./friends-box";
import { RecentGamesBox } from "./recent-games-box";
import type { UserGame } from "@types";
import {
  buildGameAchievementPath,
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";

export function ProfileContent() {
  const { userProfile, isMe, userStats } = useContext(userProfileContext);

  const dispatch = useAppDispatch();

  const { t } = useTranslation("user_profile");

  const [sortOption, setSortOption] = useState("lastPlayed"); // Estado para o critério de ordenação

  useEffect(() => {
    dispatch(setHeaderTitle(""));

    if (userProfile) {
      dispatch(setHeaderTitle(userProfile.displayName));
    }
  }, [userProfile, dispatch]);

  const { numberFormatter } = useFormat();

  const navigate = useNavigate();

  const usersAreFriends = useMemo(() => {
    return userProfile?.relation?.status === "ACCEPTED";
  }, [userProfile]);

  const buildUserGameDetailsPath = (game: UserGame) => {
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

  const sortGames = (games) => {
    return games.slice().sort((a, b) => {
      if (sortOption === "playtime") {
        return b.playTimeInSeconds - a.playTimeInSeconds;
      } else if (sortOption === "achievements") {
        const achievementPercentageA =
          a.achievementCount > 0
            ? a.unlockedAchievementCount / a.achievementCount
            : 0;
        const achievementPercentageB =
          b.achievementCount > 0
            ? b.unlockedAchievementCount / b.achievementCount
            : 0;
        return achievementPercentageB - achievementPercentageA;
      } else if (sortOption === "lastPlayed") {
        // Verifica a validade das datas
        const dateA = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
        const dateB = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
        return dateB - dateA; // Ordena de forma decrescente
      }
      return 0;
    });
  };

  const content = useMemo(() => {
    if (!userProfile) return null;

    const shouldLockProfile =
      userProfile.profileVisibility === "PRIVATE" ||
      (userProfile.profileVisibility === "FRIENDS" && !usersAreFriends);

    if (!isMe && shouldLockProfile) {
      return <LockedProfile />;
    }

    const hasGames = userProfile?.libraryGames.length > 0;

    const shouldShowRightContent = hasGames || userProfile.friends.length > 0;

    const sortedGames = sortGames(userProfile.libraryGames || []); // Ordena os jogos conforme o critério

    return (
      <section
        style={{
          display: "flex",
          gap: `${SPACING_UNIT * 3}px`,
          padding: `${SPACING_UNIT * 3}px`,
        }}
      >
        <div style={{ flex: 1 }}>
          {!hasGames && (
            <div className={styles.noGames}>
              <div className={styles.telescopeIcon}>
                <TelescopeIcon size={24} />
              </div>
              <h2>{t("no_recent_activity_title")}</h2>
              {isMe && <p>{t("no_recent_activity_description")}</p>}
            </div>
          )}

          {hasGames && (
            <>
              <div className={styles.sectionHeader}>
                <h2>{t("library")}</h2>

                {userStats && (
                  <span>{numberFormatter.format(userStats.libraryCount)}</span>
                )}
              </div>

              <div className={styles.gridSorting}>
                <label htmlFor="sort-options">Ordenar por: </label>
                <button
                  className={`${sortOption === "lastPlayed" ? styles.selectedSortOption : styles.sortOption}`}
                  onClick={() => setSortOption("lastPlayed")}
                  onKeyDown={(e) =>
                    e.key === "Enter" && setSortOption("lastPlayed")
                  } // Add keyboard support
                  tabIndex={0} // Optional if you keep using <span>
                >
                  Jogado por último
                </button>
                {" / "}
                <button
                  className={`${sortOption === "playtime" ? styles.selectedSortOption : styles.sortOption}`}
                  onClick={() => setSortOption("playtime")}
                  onKeyDown={(e) =>
                    e.key === "Enter" && setSortOption("playtime")
                  } // Add keyboard support
                  tabIndex={0} // Optional if you keep using <span>
                >
                  Tempo jogado
                </button>
                {" / "}
                <button
                  className={`${sortOption === "achievements" ? styles.selectedSortOption : styles.sortOption}`}
                  onClick={() => setSortOption("achievements")}
                  onKeyDown={(e) =>
                    e.key === "Enter" && setSortOption("achievements")
                  } // Add keyboard support
                  tabIndex={0} // Optional if you keep using <span>
                >
                  Quantidade de conquistas
                </button>
              </div>

              <ul className={styles.gamesGrid}>
                {sortedGames.map((game) => (
                  <li
                    key={game.objectId}
                    style={{
                      borderRadius: 4,
                      overflow: "hidden",
                      position: "relative",
                      display: "flex",
                    }}
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
                            "linear-gradient(0deg, rgba(0, 0, 0, 0.7) 20%, transparent 100%)",
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

                        {userProfile.hasActiveSubscription &&
                          game.achievementCount > 0 && (
                            <div
                              style={{
                                color: "white",
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
                                    {game.unlockedAchievementCount} /{" "}
                                    {game.achievementCount}
                                  </span>
                                </div>

                                <span>
                                  {formatDownloadProgress(
                                    game.unlockedAchievementCount /
                                      game.achievementCount
                                  )}
                                </span>
                              </div>

                              <progress
                                max={1}
                                value={
                                  game.unlockedAchievementCount /
                                  game.achievementCount
                                }
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
                        }}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {shouldShowRightContent && (
          <div className={styles.rightContent}>
            <RecentGamesBox />
            <FriendsBox />

            <ReportProfile />
          </div>
        )}
      </section>
    );
  }, [
    userProfile,
    isMe,
    usersAreFriends,
    userStats,
    numberFormatter,
    t,
    formatPlayTime,
    navigate,
    sortOption,
  ]);

  return (
    <div>
      <ProfileHero />

      {content}
    </div>
  );
}
