import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useUserDetails } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";
import { LockIcon, PersonIcon, TrophyIcon } from "@primer/octicons-react";
import { gameDetailsContext } from "@renderer/context";
import type { ComparedAchievements } from "@types";
import { average } from "color.js";
import Color from "color";
import { Link } from "@renderer/components";
import { ComparedAchievementList } from "./compared-achievement-list";
import { AchievementList } from "./achievement-list";
import { AchievementPanel } from "./achievement-panel";
import { ComparedAchievementPanel } from "./compared-achievement-panel";
import { useSubscription } from "@renderer/hooks/use-subscription";
import "./achievements.scss";
import "../../scss/_variables.scss";

interface UserInfo {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  totalAchievementCount: number;
  unlockedAchievementCount: number;
}

interface AchievementsContentProps {
  otherUser: UserInfo | null;
  comparedAchievements: ComparedAchievements | null;
}

interface AchievementSummaryProps {
  user: UserInfo;
  isComparison?: boolean;
}

function AchievementSummary({ user, isComparison }: AchievementSummaryProps) {
  const { t } = useTranslation("achievement");
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();

  const getProfileImage = (
    user: Pick<UserInfo, "profileImageUrl" | "displayName">
  ) => {
    return (
      <div className="achievements__profile-avatar">
        {user.profileImageUrl ? (
          <img
            className="achievements__profile-avatar"
            src={user.profileImageUrl}
            alt={user.displayName}
          />
        ) : (
          <PersonIcon size={24} />
        )}
      </div>
    );
  };

  if (isComparison && userDetails?.id == user.id && !hasActiveSubscription) {
    return (
      <div className="achievements__summary achievements__summary--locked">
        <div className="achievements__summary-overlay">
          <LockIcon size={24} />
          <h3>
            <button
              className="achievements__subscription-required-button"
              onClick={() => showHydraCloudModal("achievements")}
            >
              {t("subscription_needed")}
            </button>
          </h3>
        </div>
        <div className="achievements__summary-content achievements__summary-content--blurred">
          {getProfileImage(user)}
          <h1 className="achievements__summary-title">{user.displayName}</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="achievements__summary">
      {getProfileImage(user)}
      <div className="achievements__summary-details">
        <h1 className="achievements__summary-title">{user.displayName}</h1>
        <div className="achievements__summary-stats">
          <div className="achievements__summary-count">
            <TrophyIcon size={13} />
            <span>
              {user.unlockedAchievementCount} / {user.totalAchievementCount}
            </span>
          </div>
          <span>
            {formatDownloadProgress(
              user.unlockedAchievementCount / user.totalAchievementCount
            )}
          </span>
        </div>
        <progress
          max={1}
          value={user.unlockedAchievementCount / user.totalAchievementCount}
          className="achievements__progress-bar"
        />
      </div>
    </div>
  );
}

export function AchievementsContent({
  otherUser,
  comparedAchievements,
}: AchievementsContentProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);

  const { gameTitle, objectId, shop, achievements, gameColor, setGameColor } =
    useContext(gameDetailsContext);

  const dispatch = useAppDispatch();

  const { userDetails, hasActiveSubscription } = useUserDetails();
  useEffect(() => {
    dispatch(setHeaderTitle(gameTitle));
  }, [dispatch, gameTitle]);

  const handleHeroLoad = async () => {
    const output = await average(steamUrlBuilder.libraryHero(objectId!), {
      amount: 1,
      format: "hex",
    });

    const backgroundColor = output
      ? (new Color(output).darken(0.7).toString() as string)
      : "";

    setGameColor(backgroundColor);
  };
  const HERO_HEIGHT = 150;

  const onScroll: React.UIEventHandler<HTMLElement> = (event) => {
    const heroHeight = heroRef.current?.clientHeight ?? HERO_HEIGHT;

    const scrollY = (event.target as HTMLDivElement).scrollTop;
    if (scrollY >= heroHeight && !isHeaderStuck) {
      setIsHeaderStuck(true);
    }

    if (scrollY <= heroHeight && isHeaderStuck) {
      setIsHeaderStuck(false);
    }
  };

  const getProfileImage = (
    user: Pick<UserInfo, "profileImageUrl" | "displayName">
  ) => {
    return (
      <div className="achievements__profile-avatar-small">
        {user.profileImageUrl ? (
          <img
            className="achievements__profile-avatar-small"
            src={user.profileImageUrl}
            alt={user.displayName}
          />
        ) : (
          <PersonIcon size={24} />
        )}
      </div>
    );
  };

  if (!objectId || !shop || !gameTitle || !userDetails) return null;

  return (
    <div className="achievements__wrapper">
      <img
        src={steamUrlBuilder.libraryHero(objectId)}
        className="achievements__hidden-image"
        alt={gameTitle}
        onLoad={handleHeroLoad}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className="achievements__container"
      >
        <div
          className="achievements__gradient-background"
          style={{
            background: `linear-gradient(0deg, #1c1c1c 0%, ${gameColor} 100%)`,
          }}
        >
          <div ref={heroRef} className="achievements__hero">
            <div className="achievements__hero-content">
              <Link
                to={buildGameDetailsPath({ shop, objectId, title: gameTitle })}
              >
                <img
                  src={steamUrlBuilder.logo(objectId)}
                  className="achievements__game-logo"
                  alt={gameTitle}
                />
              </Link>
            </div>
          </div>

          <div className="achievements__summary-container">
            <AchievementSummary
              user={{
                ...userDetails,
                totalAchievementCount: comparedAchievements
                  ? comparedAchievements.owner.totalAchievementCount
                  : achievements!.length,
                unlockedAchievementCount: comparedAchievements
                  ? comparedAchievements.owner.unlockedAchievementCount
                  : achievements!.filter((achievement) => achievement.unlocked)
                      .length,
              }}
              isComparison={otherUser !== null}
            />

            {otherUser && <AchievementSummary user={otherUser} />}
          </div>
        </div>

        {otherUser && (
          <div
            className={classNames("achievements__table-header", {
              "achievements__table-header--stuck": isHeaderStuck,
            })}
          >
            <div
              className={classNames("achievements__grid-container", {
                "achievements__grid-container--no-subscription":
                  !hasActiveSubscription,
              })}
            >
              <div></div>
              {hasActiveSubscription && (
                <div className="achievements__profile-center">
                  {getProfileImage({ ...userDetails })}
                </div>
              )}
              <div className="achievements__profile-center">
                {getProfileImage(otherUser)}
              </div>
            </div>
          </div>
        )}

        {otherUser ? (
          <>
            <ComparedAchievementPanel achievements={comparedAchievements!} />
            <ComparedAchievementList achievements={comparedAchievements!} />
          </>
        ) : (
          <>
            <AchievementPanel achievements={achievements!} />
            <AchievementList achievements={achievements!} />
          </>
        )}
      </section>
    </div>
  );
}
