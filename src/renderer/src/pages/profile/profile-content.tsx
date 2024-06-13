import { UserProfile } from "@types";
import { useTranslation } from "react-i18next";
import * as styles from "./profile.css";

export interface ProfileContentProps {
  userProfile: UserProfile;
}

export const ProfileContent = ({ userProfile }: ProfileContentProps) => {
  const { t } = useTranslation("profile");

  console.log(userProfile.recentGames);
  return (
    <>
      <section className={styles.profileHeader}>
        <img
          className={styles.profileAvatar}
          src="https://avatars.githubusercontent.com/u/167933696?v=4"
        />

        <div className={styles.profileInformation}>
          <h3 style={{ fontWeight: "bold" }}>{userProfile.username}</h3>
          <p style={{ fontSize: 12 }}>Jogando ABC</p>
        </div>
      </section>
      <h2>Feed</h2>
      {userProfile.recentGames.map((game) => {
        return <p key={game.objectID}>{game.title}</p>;
      })}

      <h2>Games</h2>
      {userProfile.game.map((game) => {
        return <p key={game.objectID}>{game.title}</p>;
      })}
    </>
  );
};
