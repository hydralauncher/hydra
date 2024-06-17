import { UserGame, UserProfile } from "@types";
import cn from "classnames";
import { average } from "color.js";
import Color from "color";

import * as styles from "./user.css";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { useDate } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath } from "@renderer/helpers";
import { PersonIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useUserAuth } from "@renderer/hooks/use-user-auth";

const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;
export interface ProfileContentProps {
  userProfile: UserProfile;
}

export const UserContent = ({ userProfile }: ProfileContentProps) => {
  const { t, i18n } = useTranslation("user_profile");

  const { userAuth, signOut } = useUserAuth();

  const navigate = useNavigate();

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: 0,
    });
  }, [i18n.language]);

  const { formatDistance } = useDate();

  const formatPlayTime = () => {
    const seconds = userProfile.libraryGames.reduce(
      (acc, game) => acc + game.playTimeInSeconds,
      0
    );
    const minutes = seconds / 60;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", {
        amount: minutes.toFixed(0),
      });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  };

  const handleGameClick = (game: UserGame) => {
    navigate(buildGameDetailsPath(game));
  };

  const handleSignout = async () => {
    await signOut();
    navigate("/");
  };

  const handleAvatarLoad = async () => {
    console.log(userProfile.profileImageUrl);
    const output = await average(userProfile.profileImageUrl!, {
      amount: 1,
      format: "hex",
    });

    const backgroundColor = output
      ? (new Color(output).darken(0.7).toString() as string)
      : "";

    console.log(backgroundColor);
  };

  return (
    <>
      <section className={styles.profileContentBox}>
        <div className={styles.profileAvatarContainer}>
          {userProfile.profileImageUrl ? (
            <img
              className={styles.profileAvatar}
              alt={userProfile.displayName}
              src={userProfile.profileImageUrl}
              onLoad={handleAvatarLoad}
            />
          ) : (
            <PersonIcon size={72} />
          )}
        </div>

        <div className={styles.profileInformation}>
          <h2 style={{ fontWeight: "bold" }}>{userProfile.displayName}</h2>
        </div>

        {userAuth && userAuth.id == userProfile.id && (
          <div style={{ flex: 1, display: "flex", justifyContent: "end" }}>
            <Button theme="danger" onClick={handleSignout}>
              {t("sign_out")}
            </Button>
          </div>
        )}
      </section>

      <div className={styles.profileContent}>
        <div className={styles.profileGameSection}>
          <div>
            <h2>{t("activity")}</h2>
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
                <button
                  key={game.objectID}
                  className={cn(styles.feedItem, styles.profileContentBox)}
                  onClick={() => handleGameClick(game)}
                >
                  <img
                    className={styles.feedGameIcon}
                    src={game.cover}
                    alt={game.title}
                  />
                  <div className={styles.gameInformation}>
                    <h4>{game.title}</h4>
                    <small>
                      {t("last_time_played", {
                        period: formatDistance(
                          game.lastTimePlayed!,
                          new Date(),
                          {
                            addSuffix: true,
                          }
                        ),
                      })}
                    </small>
                  </div>
                </button>
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
            <h2>{t("library")}</h2>

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
          <small>{t("total_play_time", { amount: formatPlayTime() })}</small>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto auto",
              gap: `${SPACING_UNIT}px`,
            }}
          >
            {userProfile.libraryGames.map((game) => {
              return (
                <button
                  key={game.objectID}
                  className={cn(styles.gameListItem, styles.profileContentBox)}
                  style={{
                    padding: `${SPACING_UNIT + SPACING_UNIT / 2}px`,
                  }}
                  onClick={() => handleGameClick(game)}
                  title={game.title}
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
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};
