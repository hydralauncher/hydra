import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useDate } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "./achievements.css";
import { formatDownloadProgress } from "@renderer/helpers";
import { TrophyIcon } from "@primer/octicons-react";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { gameDetailsContext } from "@renderer/context";
import { GameShop, UserAchievement } from "@types";
import { average } from "color.js";
import Color from "color";

const HERO_ANIMATION_THRESHOLD = 25;

interface AchievementsContentProps {
  userId: string | null;
  displayName: string | null;
}

interface AchievementListProps {
  achievements: UserAchievement[];
}

interface AchievementPanelProps {
  achievements: UserAchievement[];
  displayName: string | null;
}

function AchievementPanel({
  achievements,
  displayName,
}: AchievementPanelProps) {
  const { t } = useTranslation("achievement");

  const unlockedAchievementCount = achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  const totalAchievementCount = achievements.length;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        padding: `0 ${SPACING_UNIT * 2}px`,
      }}
    >
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
  );
}

function AchievementList({ achievements }: AchievementListProps) {
  const { formatDateTime } = useDate();

  return (
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
              {achievement.unlockTime && formatDateTime(achievement.unlockTime)}
            </small>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AchievementsContent({
  userId,
  displayName,
}: AchievementsContentProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);
  const [backdropOpactiy, setBackdropOpacity] = useState(1);
  const [pageAchievements, setPageAchievements] = useState<UserAchievement[]>(
    []
  );

  const { gameTitle, objectId, shop, achievements, gameColor, setGameColor } =
    useContext(gameDetailsContext);

  const dispatch = useAppDispatch();

  useEffect(() => {
    if (gameTitle) {
      dispatch(setHeaderTitle(gameTitle));
    }
  }, [dispatch, gameTitle]);

  const handleHeroLoad = async () => {
    const output = await average(steamUrlBuilder.libraryHero(objectId!), {
      amount: 1,
      format: "hex",
    });

    const backgroundColor = output
      ? (new Color(output).darken(0.7).toString() as string)
      : "";

    setGameColor(backgroundColor);
  };

  useEffect(() => {
    if (objectId && shop && userId) {
      window.electron
        .getGameAchievements(objectId, shop as GameShop, userId)
        .then((achievements) => {
          setPageAchievements(achievements);
        });
    }
  }, [objectId, shop, userId]);

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

  if (!objectId || !shop || !gameTitle) return null;

  const userAchievements = userId ? pageAchievements : achievements;

  return (
    <div className={styles.wrapper}>
      <img
        src={steamUrlBuilder.libraryHero(objectId)}
        alt={gameTitle}
        className={styles.hero}
        onLoad={handleHeroLoad}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className={styles.container}
      >
        <div ref={heroRef} className={styles.header}>
          <div
            style={{
              backgroundColor: gameColor,
              flex: 1,
              opacity: Math.min(1, 1 - backdropOpactiy),
            }}
          />

          <div
            className={styles.heroLogoBackdrop}
            style={{ opacity: backdropOpactiy }}
          >
            <div className={styles.heroContent}>
              <img
                src={steamUrlBuilder.logo(objectId)}
                className={styles.gameLogo}
                alt={gameTitle}
              />
            </div>
          </div>
        </div>

        <div className={styles.panel({ stuck: isHeaderStuck })}>
          <AchievementPanel
            displayName={displayName}
            achievements={userAchievements}
          />
          {pageAchievements.length > 0 && (
            <AchievementPanel displayName={null} achievements={achievements} />
          )}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
          }}
        >
          {pageAchievements.length > 0 && (
            <AchievementList achievements={pageAchievements} />
          )}

          <AchievementList achievements={achievements} />
        </div>
      </section>
    </div>
  );
}
