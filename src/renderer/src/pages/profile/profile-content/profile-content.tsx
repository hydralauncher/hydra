import { userProfileContext } from "@renderer/context";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ProfileHero } from "../profile-hero/profile-hero";
import { useAppDispatch, useFormat } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { TelescopeIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { LockedProfile } from "./locked-profile";
import { ReportProfile } from "../report-profile/report-profile";
import { FriendsBox } from "./friends-box";
import { RecentGamesBox } from "./recent-games-box";
import { UserStatsBox } from "./user-stats-box";
import { UserLibraryGameCard } from "./user-library-game-card";
import "./profile-content.scss";

const GAME_STATS_ANIMATION_DURATION_IN_MS = 3500;

export function ProfileContent() {
  const { userProfile, isMe, userStats } = useContext(userProfileContext);
  const [statsIndex, setStatsIndex] = useState(0);
  const [isAnimationRunning, setIsAnimationRunning] = useState(true);
  const statsAnimation = useRef(-1);

  const dispatch = useAppDispatch();

  const { t } = useTranslation("user_profile");

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

  const usersAreFriends = useMemo(() => {
    return userProfile?.relation?.status === "ACCEPTED";
  }, [userProfile]);

  const pinnedGames = useMemo(() => {
    return userProfile?.libraryGames?.filter((game) => game.isPinned) || [];
  }, [userProfile]);

  const libraryGames = useMemo(() => {
    return userProfile?.libraryGames || [];
  }, [userProfile]);

  const content = useMemo(() => {
    if (!userProfile) return null;

    const shouldLockProfile =
      userProfile.profileVisibility === "PRIVATE" ||
      (userProfile.profileVisibility === "FRIENDS" && !usersAreFriends);

    if (!isMe && shouldLockProfile) {
      return <LockedProfile />;
    }

    const hasGames = userProfile?.libraryGames.length > 0;
    const hasPinnedGames = pinnedGames.length > 0;

    const shouldShowRightContent = hasGames || userProfile.friends.length > 0;

    return (
      <section className="profile-content__section">
        <div className="profile-content__main">
          {!hasGames && (
            <div className="profile-content__no-games">
              <div className="profile-content__telescope-icon">
                <TelescopeIcon size={24} />
              </div>
              <h2>{t("no_recent_activity_title")}</h2>
              {isMe && <p>{t("no_recent_activity_description")}</p>}
            </div>
          )}

          {hasGames && (
            <>
              {hasPinnedGames && (
                <div style={{ marginBottom: '2rem' }}>
                  <div className="profile-content__section-header">
                    <h2>{t("pinned")}</h2>
                    <span>{pinnedGames.length}</span>
                  </div>

                  <ul className="profile-content__games-grid">
                    {pinnedGames?.map((game) => (
                      <UserLibraryGameCard
                        game={game}
                        key={game.objectId}
                        statIndex={statsIndex}
                        onMouseEnter={handleOnMouseEnterGameCard}
                        onMouseLeave={handleOnMouseLeaveGameCard}
                      />
                    ))}
                  </ul>
                </div>
              )}

              <div className="profile-content__section-header">
                <h2>{t("library")}</h2>
                {userStats && (
                  <span>{numberFormatter.format(userStats.libraryCount)}</span>
                )}
              </div>

              <ul className="profile-content__games-grid">
                {libraryGames?.map((game) => (
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
  ]);

  return (
    <div>
      <ProfileHero />

      {content}
    </div>
  );
}
