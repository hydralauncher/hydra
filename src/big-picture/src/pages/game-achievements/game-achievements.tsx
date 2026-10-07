import type { GameShop, UserAchievement } from "@types";
import {
  filterAndSortAchievements,
  getAchievementStatusCounts,
  isAchievementConcealed,
  type AchievementSortOption,
  type AchievementStatusFilter,
} from "@shared";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { useNavigate, useParams } from "react-router-dom";
import { VerticalFocusGroup } from "../../components";
import {
  AchievementRow,
  GAME_ACHIEVEMENTS_LIST_REGION_ID,
  GAME_ACHIEVEMENTS_PAGE_REGION_ID,
  GAME_ACHIEVEMENTS_SEARCH_INPUT_ID,
  GameAchievementsHero,
  GameAchievementsSouvenirViewer,
  GameAchievementsToolbar,
  UserAchievementsSummary,
  getAchievementRowId,
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

export default function GameAchievements() {
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const navigate = useNavigate();
  const { shopDetails, game, achievements, isLoading } = useGameDetails(
    objectId!,
    shop!
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
  const [revealedNames, setRevealedNames] = useState<Set<string>>(
    () => new Set()
  );

  const isConcealed = useCallback(
    (achievement: Pick<UserAchievement, "name" | "hidden" | "unlocked">) =>
      isAchievementConcealed(achievement, showHiddenAchievements) &&
      !revealedNames.has(achievement.name),
    [revealedNames, showHiddenAchievements]
  );

  const [lastRevealedName, setLastRevealedName] = useState<string | null>(null);

  const handleReveal = useCallback((achievement: UserAchievement) => {
    setRevealedNames((current) => new Set(current).add(achievement.name));
    setLastRevealedName(achievement.name);
  }, []);

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

  const firstAchievementRowId = visibleAchievements[0]
    ? getAchievementRowId(visibleAchievements[0].name)
    : null;

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
              <ul className="game-achievements-page__list">
                {visibleAchievements.length === 0 ? (
                  <li className="game-achievements-page__empty">
                    {t("no_achievements_found")}
                  </li>
                ) : null}

                {visibleAchievements.map((achievement, index) => (
                  <AchievementRow
                    key={achievement.name}
                    achievement={achievement}
                    concealed={isConcealed(achievement)}
                    revealed={achievement.name === lastRevealedName}
                    showPoints={hasActiveSubscription}
                    navigationOverrides={
                      index === 0
                        ? {
                            up: {
                              type: "item",
                              itemId: GAME_ACHIEVEMENTS_SEARCH_INPUT_ID,
                            },
                          }
                        : undefined
                    }
                    onSouvenirActivate={handleSouvenirActivate}
                    onReveal={handleReveal}
                  />
                ))}
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
