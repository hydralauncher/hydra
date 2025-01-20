import { userProfileContext } from "@renderer/context";
import { useContext, useEffect, useMemo, useState, useRef } from "react";
import { ProfileHero } from "../profile-hero/profile-hero";
import { useAppDispatch, useFormat } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { SPACING_UNIT } from "@renderer/theme.css";
import * as styles from "./profile-content.css";
import {
  ClockIcon,
  TelescopeIcon,
  TrophyIcon,
  HistoryIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { LockedProfile } from "./locked-profile";
import { ReportProfile } from "../report-profile/report-profile";
import { FriendsBox } from "./friends-box";
import { RecentGamesBox } from "./recent-games-box";
import { UserStatsBox } from "./user-stats-box";
import { UserLibraryGameCard } from "./user-library-game-card";
import { sortBy } from "lodash-es";

const GAME_STATS_ANIMATION_DURATION_IN_MS = 3500;

export function ProfileContent() {
  const { userProfile, isMe, userStats } = useContext(userProfileContext);
  const [statsIndex, setStatsIndex] = useState(0);
  const [isAnimationRunning, setIsAnimationRunning] = useState(true);
  const statsAnimation = useRef(-1);

  const dispatch = useAppDispatch();

  const { t } = useTranslation("user_profile");

  const [sortOption, setSortOption] = useState("lastPlayed"); // Estado para o critério de ordenação

  useEffect(() => {
    dispatch(setHeaderTitle(""));

    if (userProfile) {
      dispatch(setHeaderTitle(userProfile.displayName));
    }
  }, [userProfile, dispatch]);

  const handleOnMouseEnterGameCard = () => {
    setIsAnimationRunning(false);
  };

  const handleOnMouseLeaveGameCard = () => {
    setIsAnimationRunning(true);
  };

  useEffect(() => {
    let zero = performance.now();
    if (!isAnimationRunning) return;

    statsAnimation.current = requestAnimationFrame(
      function animateGameStats(time) {
        if (time - zero <= GAME_STATS_ANIMATION_DURATION_IN_MS) {
          statsAnimation.current = requestAnimationFrame(animateGameStats);
        } else {
          setStatsIndex((index) => index + 1);
          zero = performance.now();
          statsAnimation.current = requestAnimationFrame(animateGameStats);
        }
      }
    );

    return () => {
      cancelAnimationFrame(statsAnimation.current);
    };
  }, [setStatsIndex, isAnimationRunning]);

  const { numberFormatter } = useFormat();

  const navigate = useNavigate();

  const usersAreFriends = useMemo(() => {
    return userProfile?.relation?.status === "ACCEPTED";
  }, [userProfile]);

  const sortGames = (games) => {
    if (sortOption === "playtime") {
      return sortBy(games, (game) => -game.playTimeInSeconds);
    } else if (sortOption === "achievements") {
      return sortBy(games, (game) => {
        return game.achievementCount > 0
          ? -(game.unlockedAchievementCount / game.achievementCount)
          : 0;
      });
    } else if (sortOption === "lastPlayed") {
      return sortBy(games, (game) => {
        return game.lastTimePlayed
          ? -new Date(game.lastTimePlayed).getTime()
          : 0;
      });
    }
    return games;
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
                <div>
                  <label htmlFor="sort-options">Ordenar por: </label>
                </div>
                <div className={styles.sortOptionsWrapper}>
                  <button
                    className={`${sortOption === "lastPlayed" ? styles.selectedSortOption : styles.sortOption}`}
                    onClick={() => setSortOption("lastPlayed")}
                    onKeyDown={(e) =>
                      e.key === "Enter" && setSortOption("lastPlayed")
                    } // Add keyboard support
                    tabIndex={0} // Optional if you keep using <span>
                  >
                    <HistoryIcon size={14} />
                    Jogados recentemente
                  </button>
                  <div className={styles.sortDivider} />
                  <button
                    className={`${sortOption === "playtime" ? styles.selectedSortOption : styles.sortOption}`}
                    onClick={() => setSortOption("playtime")}
                    onKeyDown={(e) =>
                      e.key === "Enter" && setSortOption("playtime")
                    } // Add keyboard support
                    tabIndex={0} // Optional if you keep using <span>
                  >
                    <ClockIcon size={14} />
                    Tempo jogado
                  </button>
                  <div className={styles.sortDivider} />
                  <button
                    className={`${sortOption === "achievements" ? styles.selectedSortOption : styles.sortOption}`}
                    onClick={() => setSortOption("achievements")}
                    onKeyDown={(e) =>
                      e.key === "Enter" && setSortOption("achievements")
                    } // Add keyboard support
                    tabIndex={0} // Optional if you keep using <span>
                  >
                    <TrophyIcon size={14} />
                    Conquistas obtidas
                  </button>
                </div>
              </div>

              <ul className={styles.gamesGrid}>
                {sortedGames.map((game) => (
                  <UserLibraryGameCard
                    game={game}
                    key={game.objectId}
                    statIndex={statsIndex}
                    onMouseEnter={handleOnMouseEnterGameCard}
                    onMouseLeave={handleOnMouseLeaveGameCard}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        {shouldShowRightContent && (
          <div className={styles.rightContent}>
            <UserStatsBox />
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
    navigate,
    statsIndex,
    sortOption,
  ]);

  return (
    <div>
      <ProfileHero />

      {content}
    </div>
  );
}
