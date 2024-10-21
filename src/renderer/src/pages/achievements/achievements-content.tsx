import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch, useDate, useUserDetails } from "@renderer/hooks";
import { steamUrlBuilder } from "@shared";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "./achievements.css";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";
import { LockIcon, PersonIcon, TrophyIcon } from "@primer/octicons-react";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { gameDetailsContext } from "@renderer/context";
import type { ComparedAchievements, UserAchievement } from "@types";
import { average } from "color.js";
import Color from "color";
import { Link } from "@renderer/components";
import { ComparedAchievementList } from "./compared-achievement-list";

interface UserInfo {
  id: string;
  displayName: string;
  profileImageUrl: string | null;
  totalAchievementCount: number;
  unlockedAchievementCount: number;
}

interface AchievementsContentProps {
  otherUser: UserInfo | null;
  comparedAchievements: ComparedAchievements | null;
}

interface AchievementListProps {
  achievements: UserAchievement[];
}

interface AchievementSummaryProps {
  user: UserInfo;
  isComparison?: boolean;
}

function AchievementSummary({ user, isComparison }: AchievementSummaryProps) {
  const { t } = useTranslation("achievement");
  const { userDetails, hasActiveSubscription } = useUserDetails();

  const getProfileImage = (
    user: Pick<UserInfo, "profileImageUrl" | "displayName">
  ) => {
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

  if (isComparison && userDetails?.id == user.id && !hasActiveSubscription) {
    return (
      <div
        style={{
          display: "flex",
          gap: `${SPACING_UNIT * 2}px`,
          alignItems: "center",
          position: "relative",
          padding: `${SPACING_UNIT}px`,
        }}
      >
        <div
          style={{
            position: "absolute",
            zIndex: 2,
            inset: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            alignItems: "center",
            flexDirection: "row",
            gap: `${SPACING_UNIT}px`,
            borderRadius: "4px",
            justifyContent: "center",
          }}
        >
          <LockIcon size={24} />
          <h3>
            <Link to={""}>{t("subscription_needed")}</Link>
          </h3>
        </div>
        <div
          style={{
            display: "flex",
            gap: `${SPACING_UNIT * 2}px`,
            alignItems: "center",
            height: "62px",
            position: "relative",
            filter: "blur(4px)",
          }}
        >
          {getProfileImage(user)}
          <h1 style={{ marginBottom: "8px" }}>{user.displayName}</h1>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        gap: `${SPACING_UNIT * 2}px`,
        alignItems: "center",
        padding: `${SPACING_UNIT}px`,
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
              {user.unlockedAchievementCount} / {user.totalAchievementCount}
            </span>
          </div>

          <span>
            {formatDownloadProgress(
              user.unlockedAchievementCount / user.totalAchievementCount
            )}
          </span>
        </div>
        <progress
          max={1}
          value={user.unlockedAchievementCount / user.totalAchievementCount}
          className={styles.achievementsProgressBar}
        />
      </div>
    </div>
  );
}

function AchievementList({ achievements }: AchievementListProps) {
  const { t } = useTranslation("achievement");
  const { formatDateTime } = useDate();

  return (
    <ul className={styles.list}>
      {achievements.map((achievement, index) => (
        <li key={index} className={styles.listItem} style={{ display: "flex" }}>
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

export function AchievementsContent({
  otherUser,
  comparedAchievements,
}: AchievementsContentProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isHeaderStuck, setIsHeaderStuck] = useState(false);

  const { gameTitle, objectId, shop, achievements, gameColor, setGameColor } =
    useContext(gameDetailsContext);

  const dispatch = useAppDispatch();

  const { userDetails, hasActiveSubscription } = useUserDetails();
  useEffect(() => {
    dispatch(setHeaderTitle(gameTitle));
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

  const getProfileImage = (
    user: Pick<UserInfo, "profileImageUrl" | "displayName">
  ) => {
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
              <Link
                to={buildGameDetailsPath({ shop, objectId, title: gameTitle })}
              >
                <img
                  src={steamUrlBuilder.logo(objectId)}
                  className={styles.gameLogo}
                  alt={gameTitle}
                />
              </Link>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              gap: `${SPACING_UNIT}px`,
              padding: `${SPACING_UNIT}px`,
            }}
          >
            <AchievementSummary
              user={{
                ...userDetails,
                totalAchievementCount: comparedAchievements
                  ? comparedAchievements.owner.totalAchievementCount
                  : achievements!.length,
                unlockedAchievementCount: comparedAchievements
                  ? comparedAchievements.owner.unlockedAchievementCount
                  : achievements!.filter((achievement) => achievement.unlocked)
                      .length,
              }}
              isComparison={otherUser !== null}
            />

            {otherUser && <AchievementSummary user={otherUser} />}
          </div>
        </div>

        {otherUser && (
          <div className={styles.tableHeader({ stuck: isHeaderStuck })}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: hasActiveSubscription
                  ? "3fr 1fr 1fr"
                  : "3fr 2fr",
                gap: `${SPACING_UNIT * 2}px`,
                padding: `${SPACING_UNIT}px ${SPACING_UNIT * 3}px`,
              }}
            >
              <div></div>
              {hasActiveSubscription && (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  {getProfileImage({ ...userDetails })}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "center" }}>
                {getProfileImage(otherUser)}
              </div>
            </div>
          </div>
        )}

        {otherUser ? (
          <ComparedAchievementList achievements={comparedAchievements!} />
        ) : (
          <AchievementList achievements={achievements!} />
        )}
      </section>
    </div>
  );
}
