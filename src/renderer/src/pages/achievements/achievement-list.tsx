import { useAppSelector, useDate, useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import "./achievements.scss";
import {
  CheckCircleFillIcon,
  EyeClosedIcon,
  LockIcon,
  PeopleIcon,
  SearchIcon,
  SortAscIcon,
  SortDescIcon,
  TrophyIcon,
  UnlockIcon,
} from "@primer/octicons-react";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { useCallback, useMemo, useState } from "react";
import cn from "classnames";
import { FullscreenMediaModal, TextField } from "@renderer/components";
import { RetroAchievementsConnectBanner } from "@renderer/components/retro-achievements-connect-banner/retro-achievements-connect-banner";
import {
  filterAndSortAchievements,
  formatAchievementUnlockPercentage,
  getAchievementStatusCounts,
  isAchievementConcealed,
  type AchievementSortOption,
  type AchievementStatusFilter,
} from "@shared";
import {
  AchievementSelect,
  type AchievementSelectOption,
} from "./achievement-select";

interface AchievementListProps {
  achievements: UserAchievement[];
}

export function AchievementList({
  achievements,
}: Readonly<AchievementListProps>) {
  const { t, i18n } = useTranslation("achievement");
  const { hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();
  const { formatUnlockDateTime } = useDate();
  const showHiddenAchievements = useAppSelector(
    (state) =>
      state.userPreferences.value?.showHiddenAchievementsDescription ?? false
  );

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AchievementStatusFilter>("all");
  const [sort, setSort] = useState<AchievementSortOption>("most_common");
  const [revealedNames, setRevealedNames] = useState<Set<string>>(
    () => new Set()
  );
  const [souvenir, setSouvenir] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const isConcealed = useCallback(
    (achievement: Pick<UserAchievement, "name" | "hidden" | "unlocked">) =>
      isAchievementConcealed(achievement, showHiddenAchievements) &&
      !revealedNames.has(achievement.name),
    [revealedNames, showHiddenAchievements]
  );

  const [lastRevealedName, setLastRevealedName] = useState<string | null>(null);

  const revealAchievement = (name: string) => {
    setRevealedNames((current) => new Set(current).add(name));
    setLastRevealedName(name);
  };

  const earnedPoints = useMemo(
    () =>
      achievements.reduce(
        (sum, achievement) =>
          sum + (achievement.unlocked ? (achievement.points ?? 0) : 0),
        0
      ),
    [achievements]
  );

  const totalPoints = useMemo(
    () =>
      achievements.reduce(
        (sum, achievement) => sum + (achievement.points ?? 0),
        0
      ),
    [achievements]
  );

  const statusCounts = useMemo(
    () => getAchievementStatusCounts(achievements),
    [achievements]
  );

  const visibleAchievements = useMemo(
    () =>
      filterAndSortAchievements(achievements, {
        search,
        status,
        sort,
        isConcealed,
      }),
    [achievements, isConcealed, search, sort, status]
  );

  const sortOptions: AchievementSelectOption<AchievementSortOption>[] = [
    {
      value: "most_common",
      label: t("sort_most_common"),
      icon: <SortDescIcon size={16} />,
    },
    {
      value: "most_rare",
      label: t("sort_most_rare"),
      icon: <SortAscIcon size={16} />,
    },
  ];

  const statusOptions: AchievementSelectOption<AchievementStatusFilter>[] = [
    {
      value: "all",
      label: t("all_achievements"),
      icon: <TrophyIcon size={16} />,
      count: statusCounts.all,
    },
    {
      value: "unlocked",
      label: t("unlocked"),
      icon: <UnlockIcon size={16} />,
      count: statusCounts.unlocked,
    },
    {
      value: "locked",
      label: t("locked"),
      icon: <LockIcon size={16} />,
      count: statusCounts.locked,
    },
  ];

  return (
    <div className="achievements__list-container">
      <div className="achievements__toolbar">
        <div className="achievements__toolbar-search">
          <TextField
            theme="dark"
            value={search}
            placeholder={t("search_achievements")}
            aria-label={t("search_achievements")}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <AchievementSelect
          value={status}
          options={statusOptions}
          onChange={setStatus}
          ariaLabel={t("filter_achievements")}
        />

        <AchievementSelect
          value={sort}
          options={sortOptions}
          onChange={setSort}
          ariaLabel={t("sort_achievements")}
          fitToOptions
        />

        <div className="achievements__toolbar-end">
          <RetroAchievementsConnectBanner className="achievements__toolbar-retro-achievements" />

          {hasActiveSubscription ? (
            <div className="achievements__toolbar-points">
              <span className="achievements__toolbar-points-label">
                {t("earned_points")}
              </span>
              <HydraIcon className="achievements__toolbar-points-icon" />
              <span>
                {earnedPoints} / {totalPoints}
              </span>
            </div>
          ) : (
            <button
              type="button"
              className="achievements__toolbar-points achievements__toolbar-points--locked"
              title={t("how_to_earn_achievements_points")}
              onClick={() => showHydraCloudModal("achievements-points")}
            >
              <span className="achievements__toolbar-points-label">
                {t("earned_points")}
              </span>
              <HydraIcon className="achievements__toolbar-points-icon" />
              <span className="achievements__toolbar-points-value">
                ??? / ???
              </span>
            </button>
          )}
        </div>
      </div>

      <ul className="achievements__list">
        {visibleAchievements.length === 0 && (
          <li className="achievements__empty">{t("no_achievements_found")}</li>
        )}

        {visibleAchievements.map((achievement) => {
          const concealed = isConcealed(achievement);

          return (
            <li
              key={achievement.canonicalAchievementId ?? achievement.name}
              className={cn("achievements__item", {
                "achievements__item--unlocked": achievement.unlocked,
                "achievements__item--concealed": concealed,
                "achievements__item--revealed":
                  achievement.name === lastRevealedName,
              })}
            >
              {concealed ? (
                <button
                  type="button"
                  className="achievements__item-reveal"
                  onClick={() => revealAchievement(achievement.name)}
                >
                  <span className="achievements__item-icon achievements__item-icon--concealed">
                    <EyeClosedIcon size={24} />
                  </span>

                  <span className="achievements__item-content">
                    <span className="achievements__item-title">
                      {t("hidden_achievement")}
                    </span>
                    <span className="achievements__item-description">
                      {t("click_to_reveal")}
                    </span>
                  </span>
                </button>
              ) : (
                <>
                  <div className="achievements__item-icon">
                    <img
                      className={cn("achievements__item-image", {
                        "achievements__item-image--locked":
                          !achievement.unlocked,
                      })}
                      src={achievement.icon}
                      alt={achievement.displayName}
                      loading="lazy"
                    />

                    {achievement.unlocked && (
                      <span
                        className="achievements__item-check"
                        title={t("unlocked")}
                      >
                        <CheckCircleFillIcon size={16} />
                      </span>
                    )}
                  </div>

                  <div className="achievements__item-content">
                    <h4 className="achievements__item-title">
                      {achievement.hidden && !achievement.unlocked && (
                        <span
                          className="achievements__item-hidden-icon"
                          title={t("hidden_achievement_tooltip")}
                        >
                          <EyeClosedIcon size={12} />
                        </span>
                      )}
                      {achievement.displayName}
                      {achievement.hardcoreUnlockTime != null && (
                        <span
                          className="achievements__item-hardcore-badge"
                          title={t("hardcore_unlocked_at", {
                            date: formatUnlockDateTime(
                              achievement.hardcoreUnlockTime
                            ),
                          })}
                        >
                          {t("hardcore")}
                        </span>
                      )}
                    </h4>

                    {achievement.description && (
                      <p className="achievements__item-description">
                        {achievement.description}
                      </p>
                    )}

                    {achievement.unlockTime != null && (
                      <small
                        className="achievements__item-unlock-time"
                        onMouseEnter={(event) => {
                          const element = event.currentTarget;
                          element.title =
                            element.scrollWidth > element.clientWidth
                              ? (element.textContent ?? "")
                              : "";
                        }}
                      >
                        {t("unlocked_at", {
                          date: formatUnlockDateTime(achievement.unlockTime),
                        })}
                      </small>
                    )}
                  </div>
                </>
              )}

              <div className="achievements__item-meta">
                {achievement.unlocked && achievement.imageUrl && (
                  <button
                    type="button"
                    className="achievements__item-souvenir"
                    onClick={() =>
                      setSouvenir({
                        src: achievement.imageUrl!,
                        alt: t("souvenir_alt", {
                          achievement: achievement.displayName,
                        }),
                      })
                    }
                    title={t("view_souvenir")}
                  >
                    <img
                      className="achievements__item-souvenir-image"
                      src={achievement.imageUrl}
                      alt={t("souvenir_alt", {
                        achievement: achievement.displayName,
                      })}
                      loading="lazy"
                    />

                    <span className="achievements__item-souvenir-overlay">
                      <SearchIcon size={20} />
                    </span>
                  </button>
                )}

                <div className="achievements__item-stats">
                  {achievement.globalUnlockPercentage != null && (
                    <span
                      className="achievements__item-percentage"
                      title={t("unlock_percentage_tooltip", {
                        percentage: formatAchievementUnlockPercentage(
                          achievement.globalUnlockPercentage,
                          i18n.language
                        ),
                      })}
                    >
                      <PeopleIcon size={16} />
                      <span>
                        {formatAchievementUnlockPercentage(
                          achievement.globalUnlockPercentage,
                          i18n.language
                        )}
                      </span>
                    </span>
                  )}

                  {hasActiveSubscription && achievement.points != null && (
                    <div
                      className="achievements__item-points"
                      title={t("achievement_earn_points", {
                        points: achievement.points,
                      })}
                    >
                      <HydraIcon className="achievements__item-points-icon" />
                      <span className="achievements__item-points-value">
                        {achievement.points}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <FullscreenMediaModal
        visible={souvenir !== null}
        src={souvenir?.src}
        alt={souvenir?.alt}
        upscale
        onClose={() => setSouvenir(null)}
      />
    </div>
  );
}
