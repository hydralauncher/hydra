import { userProfileContext } from "@renderer/context";
import { useContext, useEffect, useMemo } from "react";
import { ProfileHero } from "./profile-hero/profile-hero";
import { useAppDispatch } from "@renderer/hooks";
import { setHeaderTitle } from "@renderer/features";
import { steamUrlBuilder } from "@shared";
import { SPACING_UNIT } from "@renderer/theme.css";

import * as styles from "./profile-content.css";
import { ClockIcon, PeopleIcon } from "@primer/octicons-react";

export function ProfileContent() {
  const { userProfile } = useContext(userProfileContext);

  const dispatch = useAppDispatch();

  useEffect(() => {
    if (userProfile) {
      dispatch(setHeaderTitle(userProfile.displayName));
    }
  }, [userProfile, dispatch]);

  const truncatedGamesList = useMemo(() => {
    return userProfile?.libraryGames.slice(0, 12);
  }, [userProfile?.libraryGames]);

  return (
    <div>
      <ProfileHero />

      <section
        style={{
          display: "flex",
          gap: `${SPACING_UNIT * 3}px`,
          padding: `${SPACING_UNIT * 3}px`,
        }}
      >
        <div style={{}}>
          <div className={styles.sectionHeader}>
            <h2>Library</h2>

            <h3>{userProfile?.libraryGames.length}</h3>
          </div>

          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(6, 1fr)",
              gap: `${SPACING_UNIT * 2}px`,
            }}
          >
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
                  style={{ cursor: "pointer" }}
                  className={styles.gameCover}
                >
                  <img
                    src={steamUrlBuilder.cover(game.objectId)}
                    alt={game.title}
                    style={{ width: "100%" }}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div
          style={{
            minWidth: 350,
            display: "flex",
            gap: SPACING_UNIT * 2,
            flexDirection: "column",
          }}
        >
          <div>
            <div className={styles.sectionHeader}>
              <h2>Played recently</h2>
            </div>

            <div className={styles.box}>
              <ul className={styles.list}>
                {userProfile?.recentGames.map((game) => (
                  <li>
                    <button
                      type="button"
                      style={{
                        cursor: "pointer",
                        display: "flex",
                        gap: `${SPACING_UNIT}px`,
                      }}
                    >
                      <img
                        src={game.iconUrl}
                        alt={game.title}
                        style={{
                          width: "30px",
                          height: "30px",
                          borderRadius: "4px",
                        }}
                      />

                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ fontWeight: "bold" }}>{game.title}</span>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: `${SPACING_UNIT / 2}px`,
                          }}
                        >
                          <ClockIcon />
                          <span>{game.playTimeInSeconds}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <div className={styles.sectionHeader}>
              <h2>Friends</h2>

              <span>{userProfile?.totalFriends}</span>
            </div>

            <div className={styles.box}>
              <ul className={styles.list}>
                {userProfile?.friends.map((friend) => (
                  <li>
                    <button
                      type="button"
                      style={{ cursor: "pointer" }}
                      className={styles.friend}
                    >
                      <img
                        src={friend.profileImageUrl}
                        alt={friend.displayName}
                        style={{ width: "100%" }}
                        className={styles.friendAvatar}
                      />
                      <span className={styles.friendName}>
                        {friend.displayName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
