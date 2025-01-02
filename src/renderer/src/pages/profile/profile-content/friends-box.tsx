import { userProfileContext } from "@renderer/context";
import { useFormat } from "@renderer/hooks";
import { useContext } from "react";
import { useTranslation } from "react-i18next";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import * as styles from "./profile-content.css";
import { Avatar, Link } from "@renderer/components";

export function FriendsBox() {
  const { userProfile, userStats } = useContext(userProfileContext);

  const { t } = useTranslation("user_profile");

  const { numberFormatter } = useFormat();

  const getGameImage = (game: { iconUrl: string | null; title: string }) => {
    if (game.iconUrl) {
      return (
        <img
          alt={game.title}
          width={16}
          style={{ borderRadius: 4 }}
          src={game.iconUrl}
        />
      );
    }

    return <SteamLogo width={16} height={16} />;
  };

  if (!userProfile?.friends.length) return null;

  return (
    <div>
      <div className={styles.sectionHeader}>
        <h2>{t("friends")}</h2>
        {userStats && (
          <span>{numberFormatter.format(userStats.friendsCount)}</span>
        )}
      </div>

      <div className={styles.box}>
        <ul className={styles.list}>
          {userProfile?.friends.map((friend) => (
            <li
              key={friend.id}
              title={
                friend.currentGame
                  ? t("playing", { game: friend.currentGame.title })
                  : undefined
              }
            >
              <Link to={`/profile/${friend.id}`} className={styles.listItem}>
                <Avatar
                  size={32}
                  src={friend.profileImageUrl}
                  alt={friend.displayName}
                />

                <div
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <span className={styles.friendName}>
                    {friend.displayName}
                  </span>
                  {friend.currentGame && (
                    <div style={{ display: "flex", gap: 4 }}>
                      {getGameImage(friend.currentGame)}
                      <small>{friend.currentGame.title}</small>
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
