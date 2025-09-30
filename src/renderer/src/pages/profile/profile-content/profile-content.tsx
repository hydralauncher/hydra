import { userProfileContext } from "@renderer/context";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProfileHero } from "../profile-hero/profile-hero";
import { useAppDispatch, useFormat } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { TelescopeIcon, ChevronRightIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { LockedProfile } from "./locked-profile";
import { ReportProfile } from "../report-profile/report-profile";
import { FriendsBox } from "./friends-box";
import { RecentGamesBox } from "./recent-games-box";
import { UserStatsBox } from "./user-stats-box";
import { UserLibraryGameCard } from "./user-library-game-card";
import { SortOptions } from "./sort-options";
import { useSectionCollapse } from "@renderer/hooks/use-section-collapse";
import { motion, AnimatePresence } from "framer-motion";
import {
  sectionVariants,
  chevronVariants,
  GAME_STATS_ANIMATION_DURATION_IN_MS,
} from "./profile-animations";
import "./profile-content.scss";

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
      getUserLibraryGames(sortBy);
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

  const usersAreFriends = useMemo(() => {
    return userProfile?.relation?.status === "ACCEPTED";
  }, [userProfile]);

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
          {hasAnyGames && (
            <SortOptions sortBy={sortBy} onSortChange={setSortBy} />
          )}

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
                        <ul className="profile-content__games-grid">
                          {pinnedGames?.map((game) => (
                            <li
                              key={game.objectId}
                              style={{ listStyle: "none" }}
                            >
                              <UserLibraryGameCard
                                game={game}
                                statIndex={statsIndex}
                                onMouseEnter={handleOnMouseEnterGameCard}
                                onMouseLeave={handleOnMouseLeaveGameCard}
                                sortBy={sortBy}
                              />
                            </li>
                          ))}
                        </ul>
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

                  <ul className="profile-content__games-grid">
                    {libraryGames?.map((game) => (
                      <li key={game.objectId} style={{ listStyle: "none" }}>
                        <UserLibraryGameCard
                          game={game}
                          statIndex={statsIndex}
                          onMouseEnter={handleOnMouseEnterGameCard}
                          onMouseLeave={handleOnMouseLeaveGameCard}
                          sortBy={sortBy}
                        />
                      </li>
                    ))}
                  </ul>
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
    sortBy,
  ]);

  return (
    <div>
      <ProfileHero />

      {content}
    </div>
  );
}
