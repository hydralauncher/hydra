import { UserProfile } from "@types";
import { useTranslation } from "react-i18next";
import * as styles from "./profile.css";
import { SPACING_UNIT, vars } from "@renderer/theme.css";

export interface ProfileContentProps {
  userProfile: UserProfile;
}

export const ProfileContent = ({ userProfile }: ProfileContentProps) => {
  const { t } = useTranslation("profile");

  console.log(userProfile.recentGames);
  return (
    <>
      <section className={styles.profileContentBox}>
        <img
          className={styles.profileAvatar}
          src="https://avatars.githubusercontent.com/u/167933696?v=4"
        />

        <div className={styles.profileInformation}>
          <h3 style={{ fontWeight: "bold" }}>{userProfile.username}</h3>
          <p style={{ fontSize: 12 }}>Jogando ABC</p>
        </div>
      </section>

      <div className={styles.profileContent}>
        <div style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: `${SPACING_UNIT * 2}px`,
            }}
          >
            <h2>Feed</h2>

            <div
              style={{
                flex: 1,
                backgroundColor: vars.color.border,
                height: "1px",
              }}
            />
            <h3 style={{ fontWeight: "400" }}>
              {userProfile.recentGames.length}
            </h3>
          </div>
          <div
            className={styles.profileContentBox}
            style={{ flexDirection: "column" }}
          >
            {userProfile.recentGames.map((game) => {
              return <p key={game.objectID}>{game.title}</p>;
            })}
          </div>
        </div>

        <div className={styles.contentSidebar}>
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
            className={styles.profileContentBox}
            style={{ flexDirection: "column" }}
          >
            {userProfile.libraryGames.map((game) => {
              return <p key={game.objectID}>{game.title}</p>;
            })}
          </div>
        </div>
      </div>
    </>
  );
};
