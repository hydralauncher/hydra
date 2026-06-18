import type { GameShop } from "@types";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { VerticalFocusGroup } from "../../components";
import {
  AchievementRow,
  AvailablePointsBar,
  GAME_ACHIEVEMENTS_LIST_REGION_ID,
  GAME_ACHIEVEMENTS_PAGE_REGION_ID,
  GameAchievementsHero,
  UserAchievementsSummary,
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

  const unlockedCount = useMemo(
    () => achievements.filter((a) => a.unlocked).length,
    [achievements]
  );

  const totalPoints = useMemo(
    () => achievements.reduce((sum, a) => sum + (a.points ?? 0), 0),
    [achievements]
  );

  const earnedPoints = useMemo(
    () =>
      achievements.reduce(
        (sum, a) => sum + (a.unlocked ? (a.points ?? 0) : 0),
        0
      ),
    [achievements]
  );

  useHeaderTitle(shopDetails?.assets?.title);

  useNavigationScreenActions({
    press: {
      b: () => {
        navigate(-1);
      },
    },
  });

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
                    stealFocusOnAppear={index === 0}
                  />
                ))}
              </ul>
            </VerticalFocusGroup>
          </section>
        </div>
      </div>
    </VerticalFocusGroup>
  );
}
