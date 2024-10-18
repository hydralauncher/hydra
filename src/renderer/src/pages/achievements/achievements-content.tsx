import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useDate, useUserDetails } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "./achievements.css";
import { formatDownloadProgress } from "@renderer/helpers";
import {
  CheckCircleIcon,
  LockIcon,
  PersonIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { gameDetailsContext } from "@renderer/context";
import { UserAchievement } from "@types";
import { average } from "color.js";
import Color from "color";

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
  user: UserInfo;
  otherUser: UserInfo | null;
}

interface AchievementPanelProps {
  user: UserInfo;
}

function AchievementPanel({ user }: AchievementPanelProps) {
  const { userDetails, hasActiveSubscription } = useUserDetails();

  const userTotalAchievementCount = user.achievements.length;
  const userUnlockedAchievementCount = user.achievements.filter(
    (achievement) => achievement.unlocked
  ).length;

  const getProfileImage = (user: UserInfo) => {
    return (
      <div className={styles.profileAvatar}>
        {user.profileImageUrl ? (
          <img
            className={styles.profileAvatar}
            src={user.profileImageUrl}
            alt={user.displayName}
          />
        ) : (
          <PersonIcon size={24} />
        )}
      </div>
    );
  };

  if (userDetails?.id == user.userId && !hasActiveSubscription) {
    return <></>;
  }

  return (
    <div
      style={{
        display: "flex",
        gap: `${SPACING_UNIT * 2}px`,
        alignItems: "center",
      }}
    >
      {getProfileImage(user)}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
        }}
      >
        <h1 style={{ marginBottom: "8px" }}>{user.displayName}</h1>
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

function AchievementList({ user, otherUser }: AchievementListProps) {
  const achievements = user.achievements;
  const otherUserAchievements = otherUser?.achievements;

  const { t } = useTranslation("achievement");
  const { formatDateTime } = useDate();

  const { userDetails } = useUserDetails();

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
                unlocked: true,
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

          {otherUserAchievement.unlocked ? (
            <div
              style={{
                whiteSpace: "nowrap",
                display: "flex",
                flexDirection: "row",
                gap: `${SPACING_UNIT}px`,
                justifyContent: "center",
              }}
            >
              <CheckCircleIcon />
              <small>{formatDateTime(otherUserAchievement.unlockTime!)}</small>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                padding: `${SPACING_UNIT}px`,
                justifyContent: "center",
              }}
            >
              <LockIcon />
            </div>
          )}

          {userDetails?.subscription && achievements[index].unlocked ? (
            <div
              style={{
                whiteSpace: "nowrap",
                display: "flex",
                flexDirection: "row",
                gap: `${SPACING_UNIT}px`,
                justifyContent: "center",
              }}
            >
              <CheckCircleIcon />
              <small>{formatDateTime(achievements[index].unlockTime!)}</small>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                padding: `${SPACING_UNIT}px`,
                justifyContent: "center",
              }}
            >
              <LockIcon />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AchievementsContent({ otherUser }: AchievementsContentProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);

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
    if (scrollY >= heroHeight && !isHeaderStuck) {
      setIsHeaderStuck(true);
    }

    if (scrollY <= heroHeight && isHeaderStuck) {
      setIsHeaderStuck(false);
    }
  };

  const getProfileImage = (user: UserInfo) => {
    return (
      <div className={styles.profileAvatarSmall}>
        {user.profileImageUrl ? (
          <img
            className={styles.profileAvatarSmall}
            src={user.profileImageUrl}
            alt={user.displayName}
          />
        ) : (
          <PersonIcon size={24} />
        )}
      </div>
    );
  };

  if (!objectId || !shop || !gameTitle || !userDetails) return null;

  return (
    <div className={styles.wrapper}>
      <img
        src={steamUrlBuilder.libraryHero(objectId)}
        style={{ display: "none" }}
        alt={gameTitle}
        className={styles.heroImage}
        onLoad={handleHeroLoad}
      />

      <section
        ref={containerRef}
        onScroll={onScroll}
        className={styles.container}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            background: `linear-gradient(0deg, ${vars.color.darkBackground} 0%, ${gameColor} 100%)`,
          }}
        >
          <div ref={heroRef} className={styles.hero}>
            <div className={styles.heroContent}>
              <img
                src={steamUrlBuilder.logo(objectId)}
                className={styles.gameLogo}
                alt={gameTitle}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              gap: `${SPACING_UNIT * 2}px`,
              padding: `${SPACING_UNIT * 2}px`,
            }}
          >
            <AchievementPanel
              user={{
                ...userDetails,
                userId: userDetails.id,
                achievements: sortedAchievements,
              }}
            />

            {otherUser && <AchievementPanel user={otherUser} />}
          </div>
        </div>

        {otherUser && (
          <div className={styles.tableHeader({ stuck: isHeaderStuck })}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "3fr 1fr 1fr",
                gap: `${SPACING_UNIT * 2}px`,
                padding: `${SPACING_UNIT}px ${SPACING_UNIT * 3}px`,
              }}
            >
              <div></div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                {getProfileImage(otherUser)}
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                {getProfileImage({
                  ...userDetails,
                  userId: userDetails.id,
                  achievements: sortedAchievements,
                })}
              </div>
            </div>
          </div>
        )}

        <div
          style={{
            display: "flex",
            flexDirection: "row",
            width: "100%",
            backgroundColor: vars.color.background,
          }}
        >
          <AchievementList
            user={{
              ...userDetails,
              userId: userDetails.id,
              achievements: sortedAchievements,
            }}
            otherUser={otherUser}
          />
        </div>
      </section>
    </div>
  );
}
