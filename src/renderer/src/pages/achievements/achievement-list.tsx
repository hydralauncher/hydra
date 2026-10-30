import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import type { UserAchievement } from "@types";
import { useTranslation } from "react-i18next";
import "./achievements.scss";
import {
  CheckCircleFillIcon,
  ClockIcon,
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
import { Fragment, useCallback, useMemo, useState } from "react";
import cn from "classnames";
import { FullscreenMediaModal, TextField } from "@renderer/components";
import { RetroAchievementsConnectBanner } from "@renderer/components/retro-achievements-connect-banner/retro-achievements-connect-banner";
import {
  buildAchievementListEntries,
  filterAndSortAchievements,
  formatAchievementUnlockDateTime,
  formatAchievementUnlockPercentage,
  type AchievementListEntry,
  getAchievementKey,
  getAchievementStatusCounts,
  getVisibleSetGroups,
  groupAchievementsBySet,
  isAchievementConcealed,
  type AchievementSortOption,
  type AchievementStatusFilter,
} from "@shared";
import {
  AchievementSelect,
  type AchievementSelectOption,
} from "./achievement-select";
import { AchievementSetHeader } from "./achievement-set-header";
import { AchievementIcon, AchievementIconPreload } from "./achievement-icon";
import { useVirtualAchievementList } from "./use-virtual-achievement-list";
import {
  useCollapsedAchievementSets,
  useRevealedAchievements,
} from "../../../../shared/use-achievement-list-state";

interface AchievementListProps {
  achievements: UserAchievement[];
  scrollElement: HTMLElement | null;
  viewerUnlockedNames?: ReadonlySet<string>;
  pointsSummary?: { earned: number; total: number };
}

const getEntryKey = (entry: AchievementListEntry<UserAchievement>) =>
  entry.type === "set"
    ? `set-${entry.group.key}`
    : getAchievementKey(entry.achievement);

export function AchievementList({
  achievements,
  scrollElement,
  viewerUnlockedNames,
  pointsSummary,
}: Readonly<AchievementListProps>) {
  const isOtherUser = viewerUnlockedNames !== undefined;
  const { t, i18n } = useTranslation("achievement");
  const { hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();
  const formatUnlockDateTime = (date: number) =>
    formatAchievementUnlockDateTime(date, i18n.language);
  const showHiddenAchievements = useAppSelector(
    (state) =>
      state.userPreferences.value?.showHiddenAchievementsDescription ?? false
  );

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AchievementStatusFilter>("all");
  const [sort, setSort] = useState<AchievementSortOption>("most_common");
  const { revealedNames, lastRevealedName, revealAchievement } =
    useRevealedAchievements();
  const { collapsedSetKeys, toggleSet } = useCollapsedAchievementSets();
  const [souvenir, setSouvenir] = useState<{
    src: string;
    alt: string;
  } | null>(null);

  const isUnlockedByViewer = useCallback(
    (achievement: Pick<UserAchievement, "name" | "unlocked">) =>
      viewerUnlockedNames
        ? viewerUnlockedNames.has(achievement.name)
        : achievement.unlocked,
    [viewerUnlockedNames]
  );

  const isConcealed = useCallback(
    (
      achievement: Pick<
        UserAchievement,
        "name" | "canonicalAchievementId" | "hidden" | "unlocked"
      >
    ) =>
      isAchievementConcealed(
        {
          hidden: achievement.hidden,
          unlocked: isUnlockedByViewer(achievement),
        },
        showHiddenAchievements
      ) && !revealedNames.has(getAchievementKey(achievement)),
    [isUnlockedByViewer, revealedNames, showHiddenAchievements]
  );

  const earnedPoints = useMemo(
    () =>
      pointsSummary?.earned ??
      achievements.reduce(
        (sum, achievement) =>
          sum + (achievement.unlocked ? (achievement.points ?? 0) : 0),
        0
      ),
    [achievements, pointsSummary?.earned]
  );

  const totalPoints = useMemo(
    () =>
      pointsSummary?.total ??
      achievements.reduce(
        (sum, achievement) => sum + (achievement.points ?? 0),
        0
      ),
    [achievements, pointsSummary?.total]
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

  const setGroups = useMemo(
    () => groupAchievementsBySet(achievements),
    [achievements]
  );

  const visibleSetGroups = useMemo(
    () =>
      setGroups ? getVisibleSetGroups(setGroups, visibleAchievements) : null,
    [setGroups, visibleAchievements]
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
    {
      value: "recently_unlocked",
      label: t("sort_recently_unlocked"),
      icon: <ClockIcon size={16} />,
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

  const entries = useMemo(
    () =>
      buildAchievementListEntries(
        visibleSetGroups,
        visibleAchievements,
        collapsedSetKeys
      ),
    [collapsedSetKeys, visibleAchievements, visibleSetGroups]
  );

  const { listRef, virtualizer, getRowProps } = useVirtualAchievementList({
    count: entries.length,
    scrollElement,
    getItemKey: (index) => getEntryKey(entries[index]),
    isSetHeader: (index) => entries[index]?.type === "set",
  });

  const renderAchievement = (
    achievement: UserAchievement,
    rowProps: ReturnType<typeof getRowProps>
  ) => {
    const concealed = isConcealed(achievement);

    return (
      <li
        {...rowProps}
        className={cn("achievements__item", {
          "achievements__item--unlocked": achievement.unlocked,
          "achievements__item--concealed": concealed,
          "achievements__item--revealed":
            getAchievementKey(achievement) === lastRevealedName,
        })}
      >
        {concealed ? (
          <button
            type="button"
            className="achievements__item-reveal"
            onClick={() => revealAchievement(getAchievementKey(achievement))}
          >
            <span className="achievements__item-icon achievements__item-icon--concealed">
              <EyeClosedIcon size={24} />
              <AchievementIconPreload src={achievement.icon} />
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
              <AchievementIcon
                src={achievement.icon}
                alt={achievement.displayName}
                locked={!achievement.unlocked}
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
                {achievement.hidden && !isUnlockedByViewer(achievement) && (
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
  };

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
          {!isOtherUser && (
            <RetroAchievementsConnectBanner className="achievements__toolbar-retro-achievements" />
          )}

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

      {entries.length === 0 ? (
        <ul className="achievements__list">
          <li className="achievements__empty">{t("no_achievements_found")}</li>
        </ul>
      ) : (
        <ul
          ref={listRef}
          className="achievements__list achievements__list--virtual"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index];
            const rowProps = getRowProps(item.index, item.start);

            if (entry.type === "achievement") {
              return (
                <Fragment key={item.key}>
                  {renderAchievement(entry.achievement, rowProps)}
                </Fragment>
              );
            }

            return (
              <li
                key={item.key}
                {...rowProps}
                className={cn("achievements__set", {
                  "achievements__set--spaced": item.index > 0,
                })}
              >
                <AchievementSetHeader
                  set={entry.group.set}
                  expanded={entry.expanded}
                  onToggle={() => toggleSet(entry.group.key)}
                  unlockedCount={entry.group.unlockedCount}
                  totalCount={entry.group.totalCount}
                />
              </li>
            );
          })}
        </ul>
      )}

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
