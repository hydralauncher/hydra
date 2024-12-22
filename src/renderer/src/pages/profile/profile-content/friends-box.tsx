import { userProfileContext } from "@renderer/context";
import { useFormat } from "@renderer/hooks";
import { useContext } from "react";
import { useTranslation } from "react-i18next";

import * as styles from "./profile-content.css";
import { Avatar, Link } from "@renderer/components";
import { buildGameDetailsPath } from "@renderer/helpers";

export function FriendsBox() {
  const { userProfile, userStats } = useContext(userProfileContext);

  const { t } = useTranslation("user_profile");

  const { numberFormatter } = useFormat();

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
            <li key={friend.id}>
              <Link to={`/profile/${friend.id}`} className={styles.listItem}>
                <Avatar
                  size={32}
                  src={friend.profileImageUrl}
                  alt={friend.displayName}
                />

                <div>
                  <span className={styles.friendName}>
                    {friend.displayName}
                  </span>
                  {friend.currentGame && (
                    <p>{t("playing", { game: friend.currentGame.title })}</p>
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
