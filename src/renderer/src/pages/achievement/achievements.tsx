import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useDate } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import type { GameShop, UserAchievement } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as styles from "./achievements.css";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";
import { TrophyIcon } from "@primer/octicons-react";
import { SPACING_UNIT, vars } from "@renderer/theme.css";

export function Achievement() {
  const [searchParams] = useSearchParams();
  const objectId = searchParams.get("objectId");
  const shop = searchParams.get("shop");
  const title = searchParams.get("title");
  const userId = searchParams.get("userId");
  const displayName = searchParams.get("displayName");

  const { t } = useTranslation("achievement");

  const { format } = useDate();
  const navigate = useNavigate();

  const dispatch = useAppDispatch();

  const [achievements, setAchievements] = useState<UserAchievement[]>([]);

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
      dispatch(
        setHeaderTitle(
          displayName
            ? t("user_achievements", {
                displayName,
              })
            : t("your_achievements")
        )
      );
    }
  }, [dispatch, title]);

  if (!objectId || !shop || !title) return null;

  const unlockedAchievementCount = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  const totalAchievementCount = achievements.length;

  const handleClickGame = () => {
    navigate(
      buildGameDetailsPath({
        shop: shop as GameShop,
        objectId,
        title,
      })
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button onClick={handleClickGame}>
          <img
            src={steamUrlBuilder.libraryHero(objectId)}
            alt={title}
            className={styles.headerImage}
          />
        </button>
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            padding: `0 ${SPACING_UNIT * 2}px`,
          }}
        >
          <h1>{title}</h1>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              color: vars.color.muted,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <TrophyIcon size={13} />
              <span>
                {unlockedAchievementCount} / {totalAchievementCount}
              </span>
            </div>

            <span>
              {formatDownloadProgress(
                unlockedAchievementCount / totalAchievementCount
              )}
            </span>
          </div>
          <progress
            max={1}
            value={unlockedAchievementCount / totalAchievementCount}
            className={styles.achievementsProgressBar}
          />
        </div>
      </div>

      <ul className={styles.list}>
        {achievements.map((achievement, index) => (
          <li key={index} className={styles.listItem}>
            <img
              className={styles.listItemImage({
                unlocked: achievement.unlocked,
              })}
              src={achievement.icon}
              alt={achievement.displayName}
              loading="lazy"
            />
            <div>
              <p>{achievement.displayName}</p>
              <p>{achievement.description}</p>
              <small>
                {achievement.unlockTime && format(achievement.unlockTime)}
              </small>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
