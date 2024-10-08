import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useDate } from "@renderer/hooks";
import { SPACING_UNIT } from "@renderer/theme.css";
import { GameAchievement, GameShop } from "@types";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export function Achievement() {
  const [searchParams] = useSearchParams();
  const objectId = searchParams.get("objectId");
  const shop = searchParams.get("shop");
  const title = searchParams.get("title");
  const userId = searchParams.get("userId");

  const { format } = useDate();

  const dispatch = useAppDispatch();

  const [achievements, setAchievements] = useState<GameAchievement[]>([]);

  useEffect(() => {
    if (objectId && shop) {
      window.electron
        .getGameAchievements(objectId, shop as GameShop, userId || undefined)
        .then((achievements) => {
          setAchievements(achievements);
        });
    }
  }, [objectId, shop, userId]);

  useEffect(() => {
    if (title) {
      dispatch(setHeaderTitle(title + " Achievements"));
    }
  }, [dispatch, title]);

  return (
    <div>
      <h1>Achievement</h1>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: `${SPACING_UNIT}px`,
          padding: `${SPACING_UNIT * 2}px`,
        }}
      >
        {achievements.map((achievement, index) => (
          <div
            key={index}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: `${SPACING_UNIT}px`,
            }}
            title={achievement.description}
          >
            <img
              style={{
                height: "60px",
                width: "60px",
                filter: achievement.unlocked ? "none" : "grayscale(100%)",
              }}
              src={
                achievement.unlocked ? achievement.icon : achievement.icongray
              }
              alt={achievement.displayName}
              loading="lazy"
            />
            <div>
              <p>{achievement.displayName}</p>
              <p>{achievement.description}</p>
              {achievement.unlockTime && format(achievement.unlockTime)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
