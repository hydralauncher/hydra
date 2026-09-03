import type { GameShop, UserAchievement } from "@types";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { VerticalFocusGroup } from "../../components";
import {
  AchievementRow,
  AvailablePointsBar,
  GAME_ACHIEVEMENTS_LIST_REGION_ID,
  GAME_ACHIEVEMENTS_PAGE_REGION_ID,
  GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID,
  GameAchievementsHero,
  GameAchievementsSouvenirViewer,
  UserAchievementsSummary,
  getAchievementRowId,
} from "../../components/pages/game-achievements";
import {
  useGameDetails,
  useHeaderTitle,
  useNavigationScreenActions,
  useUserDetails,
} from "../../hooks";
import "./styles.scss";

export default function GameAchievements() {
  const { shop, objectId } = useParams<{ shop: GameShop; objectId: string }>();
  const navigate = useNavigate();
  const { shopDetails, game, achievements, isLoading } = useGameDetails(
    objectId!,
    shop!
  );
  const { userDetails } = useUserDetails();
  const [souvenir, setSouvenir] = useState<UserAchievement | null>(null);

  const unlockedCount = useMemo(
    () => achievements.filter((a) => a.unlocked).length,
    [achievements]
  );

  const totalPoints = useMemo(
    () => achievements.reduce((sum, a) => sum + (a.points ?? 0), 0),
    [achievements]
  );

  const firstAchievementRowId = achievements[0]
    ? getAchievementRowId(achievements[0].name)
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

  const screenActions = useMemo(
    () => ({
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
    [navigate, souvenir]
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
      <div className="game-achievements-page">
        <GameAchievementsHero shopDetails={shopDetails} game={game} />

        <div className="game-achievements-page__content">
          <UserAchievementsSummary
            userDetails={userDetails}
            unlockedCount={unlockedCount}
            totalCount={achievements.length}
            stealFocusOnAppear
            navigationOverrides={{
              up: { type: "block" },
              down: firstAchievementRowId
                ? { type: "item", itemId: firstAchievementRowId }
                : { type: "block" },
            }}
          />

          <section className="game-achievements-page__list-section">
            <AvailablePointsBar
              earnedPoints={earnedPoints}
              totalPoints={totalPoints}
            />

            <VerticalFocusGroup
              regionId={GAME_ACHIEVEMENTS_LIST_REGION_ID}
              asChild
            >
              <ul className="game-achievements-page__list">
                {achievements.map((achievement, index) => (
                  <AchievementRow
                    key={achievement.name}
                    achievement={achievement}
                    navigationOverrides={
                      index === 0
                        ? {
                            up: {
                              type: "item",
                              itemId: GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID,
                            },
                          }
                        : undefined
                    }
                    onSouvenirActivate={handleSouvenirActivate}
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
