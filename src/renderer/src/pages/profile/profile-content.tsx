import { ProfileGame, UserProfile } from "@types";
import cn from "classnames";
import * as styles from "./profile.css";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatDistance } from "date-fns";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
export interface ProfileContentProps {
  userProfile: UserProfile;
}

const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;

export const ProfileContent = ({ userProfile }: ProfileContentProps) => {
  const { t, i18n } = useTranslation("user_profile");

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: 0,
    });
  }, [i18n.language]);

  const formatPlayTime = (game: ProfileGame) => {
    console.log(game);
    const seconds = game.playTimeInSeconds;
    const minutes = seconds / 60;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", {
        amount: minutes.toFixed(0),
      });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  };

  return (
    <>
      <section
        className={styles.profileContentBox}
        style={{ padding: `${SPACING_UNIT * 2}px ${SPACING_UNIT * 2}px` }}
      >
        <img
          alt={userProfile.displayName + " profile image"}
          className={styles.profileAvatar}
          src="https://cdn.losbroxas.org/3918aa27-9b96-4fdf-b066-4c545d6667ab.png"
        />

        <div className={styles.profileInformation}>
          <h2 style={{ fontWeight: "bold" }}>{userProfile.displayName}</h2>
        </div>
      </section>

      <div className={styles.profileContent}>
        <div className={styles.profileGameSection}>
          <div>
            <h2>Feed</h2>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: `${SPACING_UNIT * 2}px`,
            }}
          >
            {userProfile.recentGames.map((game) => {
              return (
                <div
                  key={game.objectID}
                  className={cn(styles.feedItem, styles.profileContentBox)}
                >
                  <img
                    className={styles.feedGameIcon}
                    src={game.cover}
                    alt={"Icon for " + game.title}
                  />
                  <div className={styles.gameInformation}>
                    <p>{game.title}</p>
                    <p>
                      {formatDistance(game.lastTimePlayed!, new Date(), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className={cn(styles.contentSidebar, styles.profileGameSection)}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: `${SPACING_UNIT * 2}px`,
            }}
          >
            <h2>Games</h2>
            <div
              style={{
                flex: 1,
                backgroundColor: vars.color.border,
                height: "1px",
              }}
            />
            <h3 style={{ fontWeight: "400" }}>
              {userProfile.libraryGames.length}
            </h3>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: `${SPACING_UNIT}px`,
            }}
          >
            {userProfile.libraryGames.map((game) => {
              return (
                <div
                  key={game.objectID}
                  className={cn(styles.gameListItem, styles.profileContentBox)}
                  style={{
                    padding: `${SPACING_UNIT}px ${SPACING_UNIT}px`,
                  }}
                >
                  {game.iconUrl ? (
                    <img
                      className={styles.libraryGameIcon}
                      src={game.iconUrl}
                      alt={game.title}
                    />
                  ) : (
                    <SteamLogo className={styles.libraryGameIcon} />
                  )}

                  <div className={styles.gameInformation}>
                    <p>{game.title}</p>
                    <p>{formatPlayTime(game)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};
