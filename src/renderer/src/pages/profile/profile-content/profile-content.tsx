import { userProfileContext } from "@renderer/context";
import { useCallback, useContext, useEffect, useMemo } from "react";
import { ProfileHero } from "../profile-hero/profile-hero";
import { useAppDispatch } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { steamUrlBuilder } from "@shared";
import { SPACING_UNIT } from "@renderer/theme.css";

import * as styles from "./profile-content.css";
import { ClockIcon } from "@primer/octicons-react";
import { Link } from "@renderer/components";
import { useTranslation } from "react-i18next";
import { UserGame } from "@types";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { buildGameDetailsPath } from "@renderer/helpers";
import { useNavigate } from "react-router-dom";
import { LockedProfile } from "./locked-profile";

export function ProfileContent() {
  const { userProfile } = useContext(userProfileContext);

  const dispatch = useAppDispatch();

  const { i18n, t } = useTranslation("user_profile");

  useEffect(() => {
    if (userProfile) {
      dispatch(setHeaderTitle(userProfile.displayName));
    }
  }, [userProfile, dispatch]);

  const truncatedGamesList = useMemo(() => {
    if (!userProfile) return [];
    return userProfile?.libraryGames.slice(0, 12);
  }, [userProfile]);

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: 0,
    });
  }, [i18n.language]);

  const navigate = useNavigate();

  const formatPlayTime = useCallback(
    (game: UserGame) => {
      const seconds = game?.playTimeInSeconds || 0;
      const minutes = seconds / 60;

      if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
        return t("amount_minutes", {
          amount: minutes.toFixed(0),
        });
      }

      const hours = minutes / 60;
      return t("amount_hours", { amount: numberFormatter.format(hours) });
    },
    [numberFormatter, t]
  );

  const buildUserGameDetailsPath = (game: UserGame) =>
    buildGameDetailsPath({
      ...game,
      objectID: game.objectId,
    });

  const content = useMemo(() => {
    if (!userProfile) return null;

    if (userProfile?.profileVisibility === "FRIENDS") {
      return <LockedProfile />;
    }

    return (
      <section
        style={{
          display: "flex",
          gap: `${SPACING_UNIT * 3}px`,
          padding: `${SPACING_UNIT * 3}px`,
        }}
      >
        <div style={{ flex: 1 }}>
          <div className={styles.sectionHeader}>
            <h2>{t("library")}</h2>

            <h3>{numberFormatter.format(userProfile.libraryGames.length)}</h3>
          </div>

          <ul className={styles.gamesGrid}>
            {truncatedGamesList.map((game) => (
              <li
                key={game.objectId}
                style={{
                  borderRadius: 4,
                  overflow: "hidden",
                  position: "relative",
                }}
                className={styles.game}
              >
                <button
                  type="button"
                  style={{
                    cursor: "pointer",
                  }}
                  className={styles.gameCover}
                  onClick={() => navigate(buildUserGameDetailsPath(game))}
                >
                  <img
                    src={steamUrlBuilder.cover(game.objectId)}
                    alt={game.title}
                    style={{
                      width: "100%",
                      objectFit: "cover",
                      borderRadius: 4,
                    }}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.rightContent}>
          <div>
            <div className={styles.sectionHeader}>
              <h2>Played recently</h2>
            </div>

            <div className={styles.box}>
              <ul className={styles.list}>
                {userProfile?.recentGames.map((game) => (
                  <li key={`${game.shop}-${game.objectId}`}>
                    <Link
                      to={buildUserGameDetailsPath(game)}
                      className={styles.listItem}
                    >
                      <img
                        src={game.iconUrl!}
                        alt={game.title}
                        style={{
                          width: "30px",
                          height: "30px",
                          borderRadius: "4px",
                        }}
                      />

                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: `${SPACING_UNIT / 2}px`,
                        }}
                      >
                        <span style={{ fontWeight: "bold" }}>{game.title}</span>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: `${SPACING_UNIT}px`,
                          }}
                        >
                          <ClockIcon />
                          <small>{formatPlayTime(game)}</small>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <div className={styles.sectionHeader}>
              <h2>{t("friends")}</h2>
              <span>{userProfile?.totalFriends}</span>
            </div>

            <div className={styles.box}>
              <ul className={styles.list}>
                {userProfile?.friends.map((friend) => (
                  <li key={friend.id}>
                    <Link
                      to={`/profile/${friend.id}`}
                      className={styles.listItem}
                    >
                      <img
                        src={friend.profileImageUrl!}
                        alt={friend.displayName}
                        style={{
                          width: "30px",
                          height: "30px",
                          borderRadius: "4px",
                        }}
                      />
                      <span className={styles.friendName}>
                        {friend.displayName}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    );
  }, [
    userProfile,
    formatPlayTime,
    numberFormatter,
    t,
    truncatedGamesList,
    navigate,
  ]);

  return (
    <div>
      <ProfileHero />

      {content}
    </div>
  );
}
