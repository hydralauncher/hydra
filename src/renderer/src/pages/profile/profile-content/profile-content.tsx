import { userProfileContext } from "@renderer/context";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProfileHero } from "../profile-hero/profile-hero";
import { useAppDispatch, useFormat } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import {
  TelescopeIcon,
  ChevronRightIcon,
  TrophyIcon,
  ClockIcon,
  HistoryIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { UserGame } from "@types";
import { LockedProfile } from "./locked-profile";
import { ReportProfile } from "../report-profile/report-profile";
import { FriendsBox } from "./friends-box";
import { RecentGamesBox } from "./recent-games-box";
import { UserStatsBox } from "./user-stats-box";
import { UserLibraryGameCard } from "./user-library-game-card";
import { useSectionCollapse } from "@renderer/hooks/use-section-collapse";
import { motion, AnimatePresence } from "framer-motion";
import "./profile-content.scss";

const GAME_STATS_ANIMATION_DURATION_IN_MS = 3500;

const sectionVariants = {
  collapsed: {
    opacity: 0,
    y: -20,
    height: 0,
    transition: {
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1],
      opacity: { duration: 0.1 },
      y: { duration: 0.1 },
      height: { duration: 0.2 },
    },
  },
  expanded: {
    opacity: 1,
    y: 0,
    height: "auto",
    transition: {
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1],
      opacity: { duration: 0.2, delay: 0.1 },
      y: { duration: 0.3 },
      height: { duration: 0.3 },
    },
  },
};

const gameCardVariants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    scale: 0.95,
    transition: {
      duration: 0.3,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
};

const gameGridVariants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: 0.3,
      staggerChildren: 0.1,
      delayChildren: 0.1,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.2,
    },
  },
};

const chevronVariants = {
  collapsed: {
    rotate: 0,
    transition: {
      duration: 0.2,
      ease: "easeInOut",
    },
  },
  expanded: {
    rotate: 90,
    transition: {
      duration: 0.2,
      ease: "easeInOut",
    },
  },
};

type SortOption = "playtime" | "achievementCount" | "playedRecently";

export function ProfileContent() {
  const {
    userProfile,
    isMe,
    userStats,
    libraryGames,
    pinnedGames,
    getUserLibraryGames,
  } = useContext(userProfileContext);
  const [statsIndex, setStatsIndex] = useState(0);
  const [isAnimationRunning, setIsAnimationRunning] = useState(true);
  const [sortBy, setSortBy] = useState<SortOption>("playedRecently");
  const [isLoadingSort, setIsLoadingSort] = useState(false);
  const [prevLibraryGames, setPrevLibraryGames] = useState<UserGame[]>([]);
  const [prevPinnedGames, setPrevPinnedGames] = useState<UserGame[]>([]);
  const statsAnimation = useRef(-1);
  const { toggleSection, isPinnedCollapsed } = useSectionCollapse();

  const dispatch = useAppDispatch();

  const { t } = useTranslation("user_profile");

  useEffect(() => {
    dispatch(setHeaderTitle(""));

    if (userProfile) {
      dispatch(setHeaderTitle(userProfile.displayName));
    }
  }, [userProfile, dispatch]);

  useEffect(() => {
    if (userProfile) {
      setIsLoadingSort(true);
      getUserLibraryGames(sortBy).finally(() => {
        setIsLoadingSort(false);
      });
    }
  }, [sortBy, getUserLibraryGames, userProfile]);

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

  // Function to check if game lists have changed
  const gamesHaveChanged = (
    current: UserGame[],
    previous: UserGame[]
  ): boolean => {
    if (current.length !== previous.length) return true;
    return current.some(
      (game, index) => game.objectId !== previous[index]?.objectId
    );
  };

  // Check if animations should run
  const shouldAnimateLibrary = gamesHaveChanged(libraryGames, prevLibraryGames);
  const shouldAnimatePinned = gamesHaveChanged(pinnedGames, prevPinnedGames);

  // Update previous games when lists change
  useEffect(() => {
    setPrevLibraryGames(libraryGames);
  }, [libraryGames]);

  useEffect(() => {
    setPrevPinnedGames(pinnedGames);
  }, [pinnedGames]);

  const usersAreFriends = useMemo(() => {
    return userProfile?.relation?.status === "ACCEPTED";
  }, [userProfile]);

  const SortOptions = () => (
    <div className="profile-content__sort-container">
      <span className="profile-content__sort-label">Sort by:</span>
      <div className="profile-content__sort-options">
        <button
          className={`profile-content__sort-option ${sortBy === "achievementCount" ? "active" : ""} ${isLoadingSort && sortBy === "achievementCount" ? "loading" : ""}`}
          onClick={() => setSortBy("achievementCount")}
          disabled={isLoadingSort}
        >
          <TrophyIcon size={16} />
          <span>{t("achievements_earned")}</span>
        </button>
        <span className="profile-content__sort-separator">|</span>
        <button
          className={`profile-content__sort-option ${sortBy === "playedRecently" ? "active" : ""} ${isLoadingSort && sortBy === "playedRecently" ? "loading" : ""}`}
          onClick={() => setSortBy("playedRecently")}
          disabled={isLoadingSort}
        >
          <HistoryIcon size={16} />
          <span>{t("played_recently")}</span>
        </button>
        <span className="profile-content__sort-separator">|</span>
        <button
          className={`profile-content__sort-option ${sortBy === "playtime" ? "active" : ""} ${isLoadingSort && sortBy === "playtime" ? "loading" : ""}`}
          onClick={() => setSortBy("playtime")}
          disabled={isLoadingSort}
        >
          <ClockIcon size={16} />
          <span>{t("playtime")}</span>
        </button>
      </div>
    </div>
  );

  const content = useMemo(() => {
    if (!userProfile) return null;

    const shouldLockProfile =
      userProfile.profileVisibility === "PRIVATE" ||
      (userProfile.profileVisibility === "FRIENDS" && !usersAreFriends);

    if (!isMe && shouldLockProfile) {
      return <LockedProfile />;
    }

    const hasGames = libraryGames.length > 0;
    const hasPinnedGames = pinnedGames.length > 0;
    const hasAnyGames = hasGames || hasPinnedGames;

    const shouldShowRightContent =
      hasAnyGames || userProfile.friends.length > 0;

    return (
      <section className="profile-content__section">
        <div className="profile-content__main">
          {hasAnyGames && <SortOptions />}

          {!hasAnyGames && (
            <div className="profile-content__no-games">
              <div className="profile-content__telescope-icon">
                <TelescopeIcon size={24} />
              </div>
              <h2>{t("no_recent_activity_title")}</h2>
              {isMe && <p>{t("no_recent_activity_description")}</p>}
            </div>
          )}

          {hasAnyGames && (
            <div>
              {hasPinnedGames && (
                <div style={{ marginBottom: "2rem" }}>
                  <div className="profile-content__section-header">
                    <div className="profile-content__section-title-group">
                      <button
                        type="button"
                        className="profile-content__collapse-button"
                        onClick={() => toggleSection("pinned")}
                        aria-label={
                          isPinnedCollapsed
                            ? "Expand pinned section"
                            : "Collapse pinned section"
                        }
                      >
                        <motion.div
                          variants={chevronVariants}
                          animate={isPinnedCollapsed ? "collapsed" : "expanded"}
                        >
                          <ChevronRightIcon size={16} />
                        </motion.div>
                      </button>
                      <h2>{t("pinned")}</h2>
                      <span className="profile-content__section-badge">
                        {pinnedGames.length}
                      </span>
                    </div>
                  </div>

                  <AnimatePresence initial={true} mode="wait">
                    {!isPinnedCollapsed && (
                      <motion.div
                        key="pinned-content"
                        variants={sectionVariants}
                        initial="collapsed"
                        animate="expanded"
                        exit="collapsed"
                        layout
                      >
                        <motion.ul
                          className="profile-content__games-grid"
                          variants={
                            shouldAnimatePinned ? gameGridVariants : undefined
                          }
                          initial={shouldAnimatePinned ? "hidden" : undefined}
                          animate={shouldAnimatePinned ? "visible" : undefined}
                          exit={shouldAnimatePinned ? "exit" : undefined}
                          key={
                            shouldAnimatePinned
                              ? `pinned-${sortBy}`
                              : `pinned-static`
                          }
                        >
                          {shouldAnimatePinned ? (
                            <AnimatePresence mode="wait">
                              {pinnedGames?.map((game, index) => (
                                <motion.li
                                  key={game.objectId}
                                  variants={gameCardVariants}
                                  initial="hidden"
                                  animate="visible"
                                  exit="exit"
                                  transition={{ delay: index * 0.1 }}
                                  style={{ listStyle: "none" }}
                                >
                                  <UserLibraryGameCard
                                    game={game}
                                    statIndex={statsIndex}
                                    onMouseEnter={handleOnMouseEnterGameCard}
                                    onMouseLeave={handleOnMouseLeaveGameCard}
                                  />
                                </motion.li>
                              ))}
                            </AnimatePresence>
                          ) : (
                            pinnedGames?.map((game) => (
                              <li
                                key={game.objectId}
                                style={{ listStyle: "none" }}
                              >
                                <UserLibraryGameCard
                                  game={game}
                                  statIndex={statsIndex}
                                  onMouseEnter={handleOnMouseEnterGameCard}
                                  onMouseLeave={handleOnMouseLeaveGameCard}
                                />
                              </li>
                            ))
                          )}
                        </motion.ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {hasGames && (
                <div>
                  <div className="profile-content__section-header">
                    <div className="profile-content__section-title-group">
                      <h2>{t("library")}</h2>
                      {userStats && (
                        <span className="profile-content__section-badge">
                          {numberFormatter.format(userStats.libraryCount)}
                        </span>
                      )}
                    </div>
                  </div>

                  <motion.ul
                    className="profile-content__games-grid"
                    variants={
                      shouldAnimateLibrary ? gameGridVariants : undefined
                    }
                    initial={shouldAnimateLibrary ? "hidden" : undefined}
                    animate={shouldAnimateLibrary ? "visible" : undefined}
                    exit={shouldAnimateLibrary ? "exit" : undefined}
                    key={
                      shouldAnimateLibrary
                        ? `library-${sortBy}`
                        : `library-static`
                    }
                  >
                    {shouldAnimateLibrary ? (
                      <AnimatePresence mode="wait">
                        {libraryGames?.map((game, index) => (
                          <motion.li
                            key={game.objectId}
                            variants={gameCardVariants}
                            initial="hidden"
                            animate="visible"
                            exit="exit"
                            transition={{ delay: index * 0.1 }}
                            style={{ listStyle: "none" }}
                          >
                            <UserLibraryGameCard
                              game={game}
                              statIndex={statsIndex}
                              onMouseEnter={handleOnMouseEnterGameCard}
                              onMouseLeave={handleOnMouseLeaveGameCard}
                            />
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    ) : (
                      libraryGames?.map((game) => (
                        <li key={game.objectId} style={{ listStyle: "none" }}>
                          <UserLibraryGameCard
                            game={game}
                            statIndex={statsIndex}
                            onMouseEnter={handleOnMouseEnterGameCard}
                            onMouseLeave={handleOnMouseLeaveGameCard}
                          />
                        </li>
                      ))
                    )}
                  </motion.ul>
                </div>
              )}
            </div>
          )}
        </div>

        {shouldShowRightContent && (
          <div className="profile-content__right-content">
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
    statsIndex,
    libraryGames,
    pinnedGames,
    isPinnedCollapsed,
    toggleSection,
  ]);

  return (
    <div>
      <ProfileHero />

      {content}
    </div>
  );
}
