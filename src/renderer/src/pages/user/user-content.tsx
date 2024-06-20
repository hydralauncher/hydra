import { UserGame, UserProfile } from "@types";
import cn from "classnames";

import * as styles from "./user.css";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { useAppSelector, useDate, useUserDetails } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath, steamUrlBuilder } from "@renderer/helpers";
import { PersonIcon, TelescopeIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { UserEditProfileModal } from "./user-edit-modal";
import { UserSignOutModal } from "./user-signout-modal";

const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;

export interface ProfileContentProps {
  userProfile: UserProfile;
  updateUserProfile: () => Promise<void>;
}

export function UserContent({
  userProfile,
  updateUserProfile,
}: ProfileContentProps) {
  const { t, i18n } = useTranslation("user_profile");

  const { userDetails, profileBackground, signOut } = useUserDetails();

  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  const { runningGame } = useAppSelector((state) => state.runningGame);

  const navigate = useNavigate();

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: 0,
    });
  }, [i18n.language]);

  const { formatDistance, formatDiffInMillis } = useDate();

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

  const handleEditProfile = () => {
    setShowEditProfileModal(true);
  };

  const handleConfirmSignout = async () => {
    signOut();
    navigate("/");
  };

  const isMe = userDetails?.id == userProfile.id;

  const profileContentBoxBackground = useMemo(() => {
    if (profileBackground) return profileBackground;
    /* TODO: Render background colors for other users */
    return undefined;
  }, [profileBackground]);

  return (
    <>
      <UserEditProfileModal
        visible={showEditProfileModal}
        onClose={() => setShowEditProfileModal(false)}
        updateUserProfile={updateUserProfile}
        userProfile={userProfile}
      />

      <UserSignOutModal
        visible={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={handleConfirmSignout}
      />

      <section
        className={styles.profileContentBox}
        style={{
          padding: `${SPACING_UNIT * 3}px ${SPACING_UNIT * 2}px`,
          position: "relative",
        }}
      >
        {runningGame && isMe && (
          <div
            style={{
              backgroundImage: `url(${steamUrlBuilder.libraryHero(runningGame.objectID)})`,
              backgroundPosition: "top",
              position: "absolute",
              inset: 0,
              backgroundSize: "cover",
              borderRadius: "4px",
            }}
          ></div>
        )}

        <div
          style={{
            background: profileContentBoxBackground,
            position: "absolute",
            inset: 0,
            borderRadius: "4px",
          }}
        ></div>

        <div className={styles.profileAvatarContainer}>
          {userProfile.profileImageUrl ? (
            <img
              className={styles.profileAvatar}
              alt={userProfile.displayName}
              src={userProfile.profileImageUrl}
            />
          ) : (
            <PersonIcon size={72} />
          )}
        </div>

        <div className={styles.profileInformation}>
          <h2 style={{ fontWeight: "bold" }}>{userProfile.displayName}</h2>
          {isMe && runningGame && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: `${SPACING_UNIT / 2}px`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  gap: `${SPACING_UNIT}px`,
                  alignItems: "center",
                }}
              >
                <p>{runningGame.title}</p>
              </div>
              <small>
                {t("playing_for", {
                  amount: formatDiffInMillis(
                    runningGame.sessionDurationInMillis,
                    new Date()
                  ),
                })}
              </small>
            </div>
          )}
        </div>

        {isMe && (
          <div
            style={{
              flex: 1,
              display: "flex",
              justifyContent: "end",
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: `${SPACING_UNIT}px`,
              }}
            >
              <>
                <Button theme="outline" onClick={handleEditProfile}>
                  {t("edit_profile")}
                </Button>

                <Button
                  theme="danger"
                  onClick={() => setShowSignOutModal(true)}
                >
                  {t("sign_out")}
                </Button>
              </>
            </div>
          </div>
        )}
      </section>

      <div className={styles.profileContent}>
        <div className={styles.profileGameSection}>
          <h2>{t("activity")}</h2>

          {!userProfile.recentGames.length ? (
            <div className={styles.noDownloads}>
              <div className={styles.telescopeIcon}>
                <TelescopeIcon size={24} />
              </div>
              <h2>{t("no_recent_activity_title")}</h2>
              <p style={{ fontFamily: "Fira Sans" }}>
                {t("no_recent_activity_description")}
              </p>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: `${SPACING_UNIT * 2}px`,
              }}
            >
              {userProfile.recentGames.map((game) => (
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
              ))}
            </div>
          )}
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
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: `${SPACING_UNIT}px`,
            }}
          >
            {userProfile.libraryGames.map((game) => (
              <button
                key={game.objectID}
                className={cn(styles.gameListItem, styles.profileContentBox)}
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
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
