import {
  HistoryIcon,
  ListUnorderedIcon,
  LockIcon,
  PersonIcon,
  SortDescIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { Link, ProgressBar } from "@renderer/components";
import {
  FilterDropdown,
  FilterDropdownOption,
} from "@renderer/components/filter-dropdown/filter-dropdown";
import { RetroAchievementsConnectBanner } from "@renderer/components/retro-achievements-connect-banner/retro-achievements-connect-banner";
import { gameDetailsContext } from "@renderer/context";
import { setHeaderTitle } from "@renderer/features";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
  isGameCompleted,
} from "@renderer/helpers";
import { useAppDispatch, useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import type { AchievementSort, ComparedAchievements } from "@types";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AchievementList } from "./achievement-list";
import { AchievementPanel } from "./achievement-panel";
import "./achievements-content.scss";
import { ComparedAchievementList } from "./compared-achievement-list";
import { ComparedAchievementPanel } from "./compared-achievement-panel";

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
      <div className="achievements-content__profile-avatar">
        {user.profileImageUrl ? (
          <img
            className="achievements-content__profile-avatar"
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

function PointsIcon() {
  return <HydraIcon className="achievements__item-points-small" />;
}

export function AchievementsContent({
  otherUser,
  comparedAchievements,
}: AchievementsContentProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);
  const [sort, setSort] = useState<AchievementSort>("default");

  const { gameTitle, objectId, shop, shopDetails, achievements } =
    useContext(gameDetailsContext);

  const { t } = useTranslation("achievement");

  const dispatch = useAppDispatch();

  const { userDetails, hasActiveSubscription } = useUserDetails();
  useEffect(() => {
    dispatch(setHeaderTitle(gameTitle));
  }, [dispatch, gameTitle]);

  useEffect(() => {
    if (otherUser && sort === "easiest_first") {
      setSort("default");
    }
  }, [otherUser, sort]);

  const onScroll: React.UIEventHandler<HTMLElement> = (event) => {
    const heroHeight = heroRef.current?.clientHeight ?? 150;

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
      <div className="achievements-content__comparison__small-avatar">
        {user.profileImageUrl ? (
          <img
            className="achievements-content__comparison__small-avatar"
            src={user.profileImageUrl}
            alt={user.displayName}
          />
        ) : (
          <PersonIcon size={24} />
        )}
      </div>
    );
  };

  const sortOptions: FilterDropdownOption<AchievementSort>[] = [
    {
      value: "default",
      label: t("sort_option_default"),
      icon: SortDescIcon,
    },
    { value: "date", label: t("sort_option_date"), icon: HistoryIcon },
    {
      value: "easiest_first",
      label: t("sort_option_easiest_first"),
      icon: PointsIcon,
    },
    {
      value: "name",
      label: t("sort_option_name"),
      icon: ListUnorderedIcon,
    },
  ];

  const comparedSortOptions = sortOptions.filter(
    (option) => option.value !== "easiest_first"
  );

  if (!objectId || !shop || !gameTitle || !userDetails) return null;

  return (
    <div className="achievements-content__achievements-list">
      <img
        src={shopDetails?.assets?.libraryHeroImageUrl ?? ""}
        className="achievements-content__achievements-list__image"
        alt={gameTitle}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className="achievements-content__achievements-list__section"
      >
        <div className="achievements-content__achievements-list__section__container">
          <div
            ref={heroRef}
            className="achievements-content__achievements-list__section__container__hero"
          >
            <div className="achievements-content__achievements-list__section__container__hero__content">
              <Link
                to={buildGameDetailsPath({ shop, objectId, title: gameTitle })}
              >
                <img
                  src={shopDetails?.assets?.logoImageUrl ?? ""}
                  className="achievements-content__achievements-list__section__container__hero__content__game-logo"
                  alt={gameTitle}
                />
              </Link>
            </div>
          </div>

          <div className="achievements-content__achievements-list__section__container__achievements-summary-wrapper">
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
            className={`achievements-content__achievements-list__section__table-header ${isHeaderStuck ? "achievements-content__achievements-list__section__table-header--stuck" : ""}`}
          >
            <div
              className={`achievements-content__achievements-list__section__table-header__container ${hasActiveSubscription ? "achievements-content__achievements-list__section__table-header__container--has-active-subscription" : "achievements-content__achievements-list__section__table-header__container--has-no-active-subscription"}`}
            >
              <div></div>
              {hasActiveSubscription && (
                <div className="achievements-content__achievements-list__section__table-header__container__user-avatar">
                  {getProfileImage({ ...userDetails })}
                </div>
              )}
              <div className="achievements-content__achievements-list__section__table-header__container__other-user-avatar">
                {getProfileImage(otherUser)}
              </div>
            </div>
          </div>
        )}

        <RetroAchievementsConnectBanner />

        {otherUser ? (
          <>
            <div className="achievements-content__panel-container">
              <div className="achievements-content__panel-container__panel">
                <ComparedAchievementPanel
                  achievements={comparedAchievements!}
                />
              </div>
              <div className="achievements-content__panel-container__sort">
                <FilterDropdown
                  options={comparedSortOptions}
                  placeholder={t("sort_by")}
                  value={sort}
                  onChange={setSort}
                />
              </div>
            </div>
            <ComparedAchievementList
              achievements={comparedAchievements!}
              sort={sort}
            />
          </>
        ) : (
          <>
            <div className="achievements-content__panel-container">
              <div className="achievements-content__panel-container__panel">
                <AchievementPanel achievements={achievements!} />
              </div>
              <div className="achievements-content__panel-container__sort">
                <FilterDropdown
                  options={sortOptions}
                  placeholder={t("sort_by")}
                  value={sort}
                  onChange={setSort}
                />
              </div>
            </div>
            <AchievementList achievements={achievements!} sort={sort} />
          </>
        )}
      </section>
    </div>
  );
}
