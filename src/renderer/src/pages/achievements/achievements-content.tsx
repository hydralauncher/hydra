import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useUserDetails } from "@renderer/hooks";
import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
  isGameCompleted,
} from "@renderer/helpers";
import {
  LockIcon,
  PeopleIcon,
  PersonIcon,
  TrophyIcon,
  XIcon,
} from "@primer/octicons-react";
import { gameDetailsContext } from "@renderer/context";
import type { ComparedAchievements } from "@types";
import {
  getComparedOwnerUnlockedNames,
  getComparedTargetAchievements,
} from "@shared";
import { Button, Link, ProgressBar } from "@renderer/components";
import { ComparedAchievementList } from "./compared-achievement-list";
import { AchievementList } from "./achievement-list";
import { useSubscription } from "@renderer/hooks/use-subscription";
import "./achievements-content.scss";

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
  isComparing: boolean;
  onComparingChange: (isComparing: boolean) => void;
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
      <div className="achievements-content__profile-avatar">
        {user.profileImageUrl ? (
          <img
            className="achievements-content__profile-avatar-image"
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
      <div className="achievements-content__comparison">
        <div className="achievements-content__comparison__container">
          <LockIcon size={24} />
          <h3>
            <button
              className="achievements-content__comparison__container__subscription-required-button"
              onClick={() => showHydraCloudModal("achievements")}
            >
              {t("subscription_needed")}
            </button>
          </h3>
        </div>
        <div className="achievements-content__comparison__blured-avatar">
          {getProfileImage(user)}
          <h1>{user.displayName}</h1>
        </div>
      </div>
    );
  }

  const isCompleted = isGameCompleted(
    user.totalAchievementCount,
    user.unlockedAchievementCount
  );

  return (
    <div className="achievements-content__user-summary">
      {getProfileImage(user)}
      <div className="achievements-content__user-summary__container">
        <h1>{user.displayName}</h1>
        <div className="achievements-content__user-summary__container__stats">
          <div className="achievements-content__user-summary__container__stats__trophy-count">
            {!isCompleted && <TrophyIcon size={13} />}
            <span>
              {user.unlockedAchievementCount} / {user.totalAchievementCount}
            </span>
          </div>

          <span
            className={`achievements-content__user-summary__container__stats__percentage${isCompleted ? " achievements-content__user-summary__container__stats__percentage--completed" : ""}`}
          >
            {isCompleted ? (
              <TrophyIcon size={13} />
            ) : (
              formatDownloadProgress(
                user.totalAchievementCount > 0
                  ? user.unlockedAchievementCount / user.totalAchievementCount
                  : 0
              )
            )}
          </span>
        </div>
        <ProgressBar
          now={user.unlockedAchievementCount}
          max={user.totalAchievementCount}
          label={t("achievement_progress", {
            unlockedCount: user.unlockedAchievementCount,
            totalCount: user.totalAchievementCount,
          })}
          completed={isCompleted}
          trackClassName="achievements-content__user-summary__container__stats__progress-track"
          barClassName="achievements-content__user-summary__container__stats__progress-bar"
        />
      </div>
    </div>
  );
}

export function AchievementsContent({
  otherUser,
  comparedAchievements,
  isComparing,
  onComparingChange,
}: AchievementsContentProps) {
  const { t } = useTranslation("achievement");
  const { gameTitle, objectId, shop, game, shopDetails, achievements } =
    useContext(gameDetailsContext);
  const dispatch = useAppDispatch();

  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);

  const handleCompareClick = () => {
    if (!isComparing && !hasActiveSubscription) {
      showHydraCloudModal("achievements");
      return;
    }

    onComparingChange(!isComparing);
  };

  useEffect(() => {
    dispatch(setHeaderTitle(gameTitle));
  }, [dispatch, gameTitle]);

  const otherUserAchievements = useMemo(
    () =>
      comparedAchievements
        ? getComparedTargetAchievements(comparedAchievements)
        : [],
    [comparedAchievements]
  );

  const viewerUnlockedNames = useMemo(
    () =>
      comparedAchievements
        ? getComparedOwnerUnlockedNames(comparedAchievements)
        : new Set<string>(),
    [comparedAchievements]
  );

  const heroImage =
    game?.customHeroImageUrl || shopDetails?.assets?.libraryHeroImageUrl || "";

  const logoImage =
    game?.customLogoImageUrl || shopDetails?.assets?.logoImageUrl || "";

  if (!objectId || !shop || !gameTitle || !userDetails) return null;

  return (
    <div className="achievements-content__achievements-list">
      <section
        ref={setScrollElement}
        className="achievements-content__achievements-list__section"
      >
        <div className="achievements-content__achievements-list__section__container">
          <div className="achievements-content__achievements-list__section__container__banner">
            {heroImage && (
              <img
                src={heroImage}
                className="achievements-content__achievements-list__section__container__banner-background"
                alt=""
                aria-hidden="true"
                loading="lazy"
              />
            )}
            <div className="achievements-content__achievements-list__section__container__hero">
              <div className="achievements-content__achievements-list__section__container__hero__content">
                <Link
                  to={buildGameDetailsPath({
                    shop,
                    objectId,
                    title: gameTitle,
                  })}
                >
                  {logoImage ? (
                    <img
                      src={logoImage}
                      className="achievements-content__achievements-list__section__container__hero__content__game-logo"
                      alt={gameTitle}
                    />
                  ) : (
                    <span className="achievements-content__achievements-list__section__container__hero__content__game-title">
                      {gameTitle}
                    </span>
                  )}
                </Link>

                {otherUser && (
                  <Button
                    theme="outline"
                    className="achievements-content__compare-button"
                    onClick={handleCompareClick}
                  >
                    {isComparing ? (
                      <XIcon size={16} />
                    ) : (
                      <PeopleIcon size={16} />
                    )}
                    {isComparing ? t("stop_comparing") : t("compare_with_me")}
                  </Button>
                )}
              </div>
            </div>

            <div className="achievements-content__achievements-list__section__container__achievements-summary-wrapper">
              {(!otherUser || isComparing) && (
                <AchievementSummary
                  user={{
                    ...userDetails,
                    totalAchievementCount: comparedAchievements
                      ? comparedAchievements.owner.totalAchievementCount
                      : achievements!.length,
                    unlockedAchievementCount: comparedAchievements
                      ? comparedAchievements.owner.unlockedAchievementCount
                      : achievements!.filter(
                          (achievement) => achievement.unlocked
                        ).length,
                  }}
                  isComparison={otherUser !== null}
                />
              )}

              {otherUser && <AchievementSummary user={otherUser} />}
            </div>
          </div>
        </div>

        {otherUser && isComparing && (
          <ComparedAchievementList
            scrollElement={scrollElement}
            achievements={comparedAchievements!}
            owner={userDetails}
            target={otherUser}
          />
        )}

        {otherUser && !isComparing && (
          <AchievementList
            scrollElement={scrollElement}
            achievements={otherUserAchievements}
            viewerUnlockedNames={viewerUnlockedNames}
            pointsSummary={
              comparedAchievements
                ? {
                    earned:
                      comparedAchievements.target.achievementsPointsEarnedSum,
                    total: comparedAchievements.achievementsPointsTotal,
                  }
                : undefined
            }
          />
        )}

        {!otherUser && (
          <AchievementList
            scrollElement={scrollElement}
            achievements={achievements!}
          />
        )}
      </section>
    </div>
  );
}
