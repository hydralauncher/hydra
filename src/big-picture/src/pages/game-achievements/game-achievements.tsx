import type { GameShop, UserAchievement } from "@types";
import {
  buildAchievementListEntries,
  filterAndSortAchievements,
  getAchievementKey,
  getAchievementStatusCounts,
  getVisibleSetGroups,
  groupAchievementsBySet,
  isAchievementConcealed,
  type AchievementListEntry,
  type AchievementSortOption,
  type AchievementStatusFilter,
} from "@shared";
import { useCallback, useMemo, useRef, useState } from "react";
import { useVirtualList } from "../../../../shared/use-virtual-list";
import {
  useCollapsedAchievementSets,
  useRevealedAchievements,
} from "../../../../shared/use-achievement-list-state";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { useNavigate, useParams } from "react-router-dom";
import { VerticalFocusGroup } from "../../components";
import {
  AchievementRow,
  AchievementSetHeader,
  GAME_ACHIEVEMENTS_LIST_REGION_ID,
  GAME_ACHIEVEMENTS_PAGE_REGION_ID,
  GAME_ACHIEVEMENTS_SEARCH_INPUT_ID,
  GameAchievementsHero,
  GameAchievementsSouvenirViewer,
  GameAchievementsToolbar,
  UserAchievementsSummary,
  getAchievementRowId,
  getAchievementSetId,
} from "../../components/pages/game-achievements";
import {
  useGameDetails,
  useHeaderTitle,
  useNavigationActions,
  useNavigationScreenActions,
  useUserDetails,
  useUserPreferences,
} from "../../hooks";
import "./styles.scss";

const ESTIMATED_ROW_HEIGHT = 92;
const ESTIMATED_SET_HEADER_HEIGHT = 72;
const ROW_GAP = 4;
const OVERSCAN = 6;

const getListEntryId = (entry: AchievementListEntry<UserAchievement>) =>
  entry.type === "set"
    ? getAchievementSetId(entry.group.key)
    : getAchievementRowId(getAchievementKey(entry.achievement));

export default function GameAchievements() {
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const navigate = useNavigate();
  const { shopDetails, game, achievements, isLoading } = useGameDetails(
    objectId!,
    shop!,
    true
  );
  const { t } = useTranslation("achievement");
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const userPreferences = useUserPreferences();
  const showHiddenAchievements =
    userPreferences?.showHiddenAchievementsDescription ?? false;
  const [souvenir, setSouvenir] = useState<UserAchievement | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AchievementStatusFilter>("all");
  const [sort, setSort] = useState<AchievementSortOption>("most_common");
  const { revealedNames, lastRevealedName, revealAchievement } =
    useRevealedAchievements();
  const { collapsedSetKeys, toggleSet } = useCollapsedAchievementSets();

  const isConcealed = useCallback(
    (
      achievement: Pick<
        UserAchievement,
        "name" | "canonicalAchievementId" | "hidden" | "unlocked"
      >
    ) =>
      isAchievementConcealed(achievement, showHiddenAchievements) &&
      !revealedNames.has(getAchievementKey(achievement)),
    [revealedNames, showHiddenAchievements]
  );

  const handleReveal = useCallback(
    (achievement: UserAchievement) =>
      revealAchievement(getAchievementKey(achievement)),
    [revealAchievement]
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

  const unlockedCount = useMemo(
    () => achievements.filter((a) => a.unlocked).length,
    [achievements]
  );

  const totalPoints = useMemo(
    () => achievements.reduce((sum, a) => sum + (a.points ?? 0), 0),
    [achievements]
  );

  const setGroups = useMemo(
    () => groupAchievementsBySet(achievements),
    [achievements]
  );

  const listEntries = useMemo(
    () =>
      buildAchievementListEntries(
        setGroups ? getVisibleSetGroups(setGroups, visibleAchievements) : null,
        visibleAchievements,
        collapsedSetKeys
      ),
    [collapsedSetKeys, setGroups, visibleAchievements]
  );

  const firstAchievementRowId = listEntries[0]
    ? getListEntryId(listEntries[0])
    : null;

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { listRef, virtualizer, getRowProps } = useVirtualList({
    count: listEntries.length,
    scrollRef,
    getItemKey: (index) => getListEntryId(listEntries[index]),
    estimateSize: (index) =>
      listEntries[index]?.type === "set"
        ? ESTIMATED_SET_HEADER_HEIGHT
        : ESTIMATED_ROW_HEIGHT,
    gap: ROW_GAP,
    overscan: OVERSCAN,
  });

  const earnedPoints = useMemo(
    () =>
      achievements.reduce(
        (sum, a) => sum + (a.unlocked ? (a.points ?? 0) : 0),
        0
      ),
    [achievements]
  );

  useHeaderTitle(shopDetails?.assets?.title);

  const handleSouvenirActivate = useCallback(
    (achievement: UserAchievement) => setSouvenir(achievement),
    []
  );

  const { moveFocus } = useNavigationActions();
  const [hasNavigated, setHasNavigated] = useState(false);

  const screenActions = useMemo(
    () => ({
      direction: hasNavigated
        ? undefined
        : Object.fromEntries(
            (["up", "down", "left", "right"] as const).map((direction) => [
              direction,
              () => {
                setHasNavigated(true);
                moveFocus(direction);
              },
            ])
          ),
      press: {
        b: () => {
          if (souvenir) {
            setSouvenir(null);
            return;
          }

          navigate(-1);
        },
      },
    }),
    [hasNavigated, moveFocus, navigate, souvenir]
  );

  useNavigationScreenActions(screenActions);

  if (isLoading || !shopDetails) {
    return (
      <VerticalFocusGroup regionId={GAME_ACHIEVEMENTS_PAGE_REGION_ID} asChild>
        <div className="game-achievements-page">
          <p style={{ color: "white", padding: 24 }}>Loading...</p>
        </div>
      </VerticalFocusGroup>
    );
  }

  return (
    <VerticalFocusGroup regionId={GAME_ACHIEVEMENTS_PAGE_REGION_ID} asChild>
      <div
        ref={scrollRef}
        className={cn("game-achievements-page", {
          "game-achievements-page--pristine": !hasNavigated,
        })}
      >
        <GameAchievementsHero shopDetails={shopDetails} game={game} />

        <div className="game-achievements-page__content">
          <UserAchievementsSummary
            userDetails={userDetails}
            unlockedCount={unlockedCount}
            totalCount={achievements.length}
            stealFocusOnAppear
            navigationOverrides={{
              up: { type: "block" },
              down: { type: "item", itemId: GAME_ACHIEVEMENTS_SEARCH_INPUT_ID },
            }}
          />

          <GameAchievementsToolbar
            search={search}
            onSearchChange={setSearch}
            sort={sort}
            onSortChange={setSort}
            status={status}
            onStatusChange={setStatus}
            statusCounts={statusCounts}
            firstAchievementRowId={firstAchievementRowId}
            points={
              hasActiveSubscription
                ? { earned: earnedPoints, total: totalPoints }
                : null
            }
          />

          <section className="game-achievements-page__list-section">
            <VerticalFocusGroup
              regionId={GAME_ACHIEVEMENTS_LIST_REGION_ID}
              asChild
            >
              <ul
                ref={listRef}
                className={cn("game-achievements-page__list", {
                  "game-achievements-page__list--virtual":
                    listEntries.length > 0,
                })}
                style={
                  listEntries.length > 0
                    ? { height: virtualizer.getTotalSize() }
                    : undefined
                }
              >
                {listEntries.length === 0 ? (
                  <li className="game-achievements-page__empty">
                    {t("no_achievements_found")}
                  </li>
                ) : null}

                {virtualizer.getVirtualItems().map((item) => {
                  const entry = listEntries[item.index];
                  const virtualRow = getRowProps(item.index, item.start);
                  const navigationOverrides =
                    item.index === 0
                      ? {
                          up: {
                            type: "item" as const,
                            itemId: GAME_ACHIEVEMENTS_SEARCH_INPUT_ID,
                          },
                        }
                      : undefined;

                  if (entry.type === "set") {
                    return (
                      <AchievementSetHeader
                        key={item.key}
                        setKey={entry.group.key}
                        set={entry.group.set}
                        expanded={entry.expanded}
                        unlockedCount={entry.group.unlockedCount}
                        totalCount={entry.group.totalCount}
                        navigationOrder={item.index}
                        navigationOverrides={navigationOverrides}
                        spaced={item.index > 0}
                        virtualRow={virtualRow}
                        onToggle={() => toggleSet(entry.group.key)}
                      />
                    );
                  }

                  const { achievement } = entry;

                  return (
                    <AchievementRow
                      key={item.key}
                      achievement={achievement}
                      concealed={isConcealed(achievement)}
                      revealed={
                        getAchievementKey(achievement) === lastRevealedName
                      }
                      showPoints={hasActiveSubscription}
                      navigationOrder={item.index}
                      navigationOverrides={navigationOverrides}
                      virtualRow={virtualRow}
                      onSouvenirActivate={handleSouvenirActivate}
                      onReveal={handleReveal}
                    />
                  );
                })}
              </ul>
            </VerticalFocusGroup>
          </section>
        </div>

        {souvenir?.imageUrl ? (
          <GameAchievementsSouvenirViewer
            src={souvenir.imageUrl}
            alt={`${souvenir.displayName} souvenir`}
            onClose={() => setSouvenir(null)}
          />
        ) : null}
      </div>
    </VerticalFocusGroup>
  );
}
