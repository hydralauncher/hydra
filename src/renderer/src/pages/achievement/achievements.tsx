import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useDate } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import type { GameShop, UserAchievement } from "@types";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import * as styles from "./achievements.css";
import { formatDownloadProgress } from "@renderer/helpers";
import { TrophyIcon } from "@primer/octicons-react";
import { vars } from "@renderer/theme.css";

const HERO_ANIMATION_THRESHOLD = 25;

export function Achievement() {
  const [searchParams] = useSearchParams();
  const objectId = searchParams.get("objectId");
  const shop = searchParams.get("shop");
  const title = searchParams.get("title");
  const userId = searchParams.get("userId");
  const displayName = searchParams.get("displayName");

  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);
  const [backdropOpactiy, setBackdropOpacity] = useState(1);

  const { t } = useTranslation("achievement");

  const { format } = useDate();

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
      dispatch(setHeaderTitle(title));
    }
  }, [dispatch, title]);

  const onScroll: React.UIEventHandler<HTMLElement> = (event) => {
    const heroHeight = heroRef.current?.clientHeight ?? styles.HERO_HEIGHT;

    const scrollY = (event.target as HTMLDivElement).scrollTop;
    const opacity = Math.max(
      0,
      1 - scrollY / (heroHeight - HERO_ANIMATION_THRESHOLD)
    );

    if (scrollY >= heroHeight && !isHeaderStuck) {
      setIsHeaderStuck(true);
    }

    if (scrollY <= heroHeight && isHeaderStuck) {
      setIsHeaderStuck(false);
    }

    setBackdropOpacity(opacity);
  };

  if (!objectId || !shop || !title) return null;

  const unlockedAchievementCount = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  const totalAchievementCount = achievements.length;

  return (
    <div className={styles.wrapper}>
      <img
        src={steamUrlBuilder.libraryHero(objectId)}
        alt={title}
        className={styles.headerImage}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className={styles.container}
      >
        <div className={styles.header}>
          <div
            style={{
              flex: 1,
              opacity: Math.min(1, 1 - backdropOpactiy),
            }}
          />

          <img
            src={steamUrlBuilder.logo(objectId!)}
            className={styles.gameLogo}
            alt={title}
          />
        </div>

        <div className={styles.panel({ stuck: isHeaderStuck })}>
          <h1 style={{ fontSize: "1.2em", marginBottom: "8px" }}>
            {displayName
              ? t("user_achievements", {
                  displayName,
                })
              : t("your_achievements")}
          </h1>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 8,
              width: "100%",
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
      </section>
    </div>
  );
}
