import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useDate, useUserDetails } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "./achievements.css";
import { formatDownloadProgress } from "@renderer/helpers";
import { PersonIcon, TrophyIcon } from "@primer/octicons-react";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { gameDetailsContext } from "@renderer/context";
import { UserAchievement } from "@types";
import { average } from "color.js";
import Color from "color";

const HERO_ANIMATION_THRESHOLD = 25;

interface UserInfo {
  userId: string;
  displayName: string;
  achievements: UserAchievement[];
  profileImageUrl: string | null;
}

interface AchievementsContentProps {
  otherUser: UserInfo | null;
}

interface AchievementListProps {
  achievements: UserAchievement[];
  otherUserAchievements?: UserAchievement[];
}

interface AchievementPanelProps {
  user: UserInfo;
  otherUser: UserInfo | null;
}

function AchievementPanel({ user, otherUser }: AchievementPanelProps) {
  const { t } = useTranslation("achievement");
  const { userDetails } = useUserDetails();

  const getProfileImage = (imageUrl: string | null | undefined) => {
    return (
      <div className={styles.profileAvatar}>
        {imageUrl ? (
          <img className={styles.profileAvatar} src={imageUrl} alt={"teste"} />
        ) : (
          <PersonIcon size={24} />
        )}
      </div>
    );
  };

  const userTotalAchievementCount = user.achievements.length;
  const userUnlockedAchievementCount = user.achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  if (!otherUser) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          width: "100%",
          padding: `0 ${SPACING_UNIT * 2}px`,
          gap: `${SPACING_UNIT * 2}px`,
        }}
      >
        {getProfileImage(user.profileImageUrl)}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
          }}
        >
          <h1 style={{ fontSize: "1.2em", marginBottom: "8px" }}>
            {t("your_achievements")}
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
                {userUnlockedAchievementCount} / {userTotalAchievementCount}
              </span>
            </div>

            <span>
              {formatDownloadProgress(
                userUnlockedAchievementCount / userTotalAchievementCount
              )}
            </span>
          </div>
          <progress
            max={1}
            value={userUnlockedAchievementCount / userTotalAchievementCount}
            className={styles.achievementsProgressBar}
          />
        </div>
      </div>
    );
  }

  const otherUserUnlockedAchievementCount = otherUser.achievements.filter(
    (achievement) => achievement.unlocked
  ).length;
  const otherUserTotalAchievementCount = otherUser.achievements.length;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "3fr 1fr 1fr",
        gap: `${SPACING_UNIT * 2}px`,
        padding: `${SPACING_UNIT}px`,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <h1 style={{ fontSize: "1.2em", marginBottom: "8px" }}>
            {otherUser.displayName}
          </h1>
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
                {otherUserUnlockedAchievementCount} /{" "}
                {otherUserTotalAchievementCount}
              </span>
            </div>

            <span>
              {formatDownloadProgress(
                otherUserUnlockedAchievementCount /
                  otherUserTotalAchievementCount
              )}
            </span>
          </div>
          <progress
            max={1}
            value={
              otherUserUnlockedAchievementCount / otherUserTotalAchievementCount
            }
            className={styles.achievementsProgressBar}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <h1 style={{ fontSize: "1.2em", marginBottom: "8px" }}>
            {userDetails?.displayName}
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
                {userUnlockedAchievementCount} / {userTotalAchievementCount}
              </span>
            </div>

            <span>
              {formatDownloadProgress(
                userUnlockedAchievementCount / userTotalAchievementCount
              )}
            </span>
          </div>
          <progress
            max={1}
            value={userUnlockedAchievementCount / userTotalAchievementCount}
            className={styles.achievementsProgressBar}
          />
        </div>
      </div>
      <div>{getProfileImage(otherUser.profileImageUrl)}</div>
      <div>{getProfileImage(user.profileImageUrl)}</div>
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
          style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr" }}
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
            <div>
              <h4>{otherUserAchievement.displayName}</h4>
              <p>{otherUserAchievement.description}</p>
            </div>
          </div>

          <div>
            {otherUserAchievement.unlockTime ? (
              <div style={{ whiteSpace: "nowrap" }}>
                <small>{t("unlocked_at")}</small>
                <p>{formatDateTime(otherUserAchievement.unlockTime)}</p>
              </div>
            ) : (
              "Não desbloqueada"
            )}
          </div>

          <div>
            {achievements[index].unlockTime ? (
              <div style={{ whiteSpace: "nowrap" }}>
                <small>{t("unlocked_at")}</small>
                <p>{formatDateTime(achievements[index].unlockTime)}</p>
              </div>
            ) : (
              "Não desbloqueada"
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

  const { userDetails } = useUserDetails();

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

  if (!objectId || !shop || !gameTitle || !userDetails) return null;

  return (
    <div className={styles.wrapper}>
      <img
        src={steamUrlBuilder.libraryHero(objectId)}
        alt={gameTitle}
        className={styles.heroImage}
        onLoad={handleHeroLoad}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className={styles.container}
      >
        <div ref={heroRef} className={styles.hero}>
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
            user={{
              ...userDetails,
              userId: userDetails.id,
              achievements: achievements!,
            }}
            otherUser={otherUser}
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
