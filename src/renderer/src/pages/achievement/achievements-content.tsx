import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useDate } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "./achievements.css";
import { formatDownloadProgress } from "@renderer/helpers";
import { TrophyIcon } from "@primer/octicons-react";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { gameDetailsContext } from "@renderer/context";
import { UserAchievement } from "@types";
import { average } from "color.js";
import Color from "color";

const HERO_ANIMATION_THRESHOLD = 25;

interface AchievementsContentProps {
  otherUser: {
    userId: string;
    displayName: string;
    achievements: UserAchievement[];
  } | null;
}

interface AchievementListProps {
  achievements: UserAchievement[];
  otherUserAchievements?: UserAchievement[];
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

function AchievementList({
  achievements,
  otherUserAchievements,
}: AchievementListProps) {
  const { t } = useTranslation("achievement");
  const { formatDateTime } = useDate();

  if (!otherUserAchievements || otherUserAchievements.length === 0) {
    return (
      <ul className={styles.list}>
        {achievements.map((achievement, index) => (
          <li
            key={index}
            className={styles.listItem}
            style={{ display: "flex" }}
          >
            <img
              className={styles.listItemImage({
                unlocked: achievement.unlocked,
              })}
              src={achievement.icon}
              alt={achievement.displayName}
              loading="lazy"
            />
            <div style={{ flex: 1 }}>
              <h4>{achievement.displayName}</h4>
              <p>{achievement.description}</p>
            </div>
            {achievement.unlockTime && (
              <div style={{ whiteSpace: "nowrap" }}>
                <small>{t("unlocked_at")}</small>
                <p>{formatDateTime(achievement.unlockTime)}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className={styles.list}>
      {otherUserAchievements.map((otherUserAchievement, index) => (
        <li
          key={index}
          className={styles.listItem}
          style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr" }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: `${SPACING_UNIT}px`,
            }}
          >
            <img
              className={styles.listItemImage({
                unlocked: otherUserAchievement.unlocked,
              })}
              src={otherUserAchievement.icon}
              alt={otherUserAchievement.displayName}
              loading="lazy"
            />
            {otherUserAchievement.unlockTime && (
              <div style={{ whiteSpace: "nowrap" }}>
                <small>{t("unlocked_at")}</small>
                <p>{formatDateTime(otherUserAchievement.unlockTime)}</p>
              </div>
            )}
          </div>

          <div style={{ textAlign: "center" }}>
            <h4>{otherUserAchievement.displayName}</h4>
            <p>{otherUserAchievement.description}</p>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "row-reverse",
              alignItems: "center",
              gap: `${SPACING_UNIT}px`,
              textAlign: "right",
            }}
          >
            <img
              className={styles.listItemImage({
                unlocked: achievements[index].unlocked,
              })}
              src={achievements[index].icon}
              alt={achievements[index].displayName}
              loading="lazy"
            />
            {achievements[index].unlockTime && (
              <div style={{ whiteSpace: "nowrap" }}>
                <small>{t("unlocked_at")}</small>
                <p>{formatDateTime(achievements[index].unlockTime)}</p>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AchievementsContent({ otherUser }: AchievementsContentProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);
  const [backdropOpactiy, setBackdropOpacity] = useState(1);

  const { gameTitle, objectId, shop, achievements, gameColor, setGameColor } =
    useContext(gameDetailsContext);

  const sortedAchievements = useMemo(() => {
    if (!otherUser || otherUser.achievements.length === 0) return achievements!;

    return achievements!.sort((a, b) => {
      const indexA = otherUser.achievements.findIndex(
        (achievement) => achievement.name === a.name
      );
      const indexB = otherUser.achievements.findIndex(
        (achievement) => achievement.name === b.name
      );
      return indexA - indexB;
    });
  }, [achievements, otherUser]);

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
          {otherUser && (
            <AchievementPanel
              displayName={otherUser.displayName}
              achievements={otherUser.achievements}
            />
          )}

          <AchievementPanel
            displayName={null}
            achievements={sortedAchievements}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            width: "100%",
            backgroundColor: vars.color.background,
          }}
        >
          <AchievementList
            achievements={sortedAchievements}
            otherUserAchievements={otherUser?.achievements}
          />
        </div>
      </section>
    </div>
  );
}
