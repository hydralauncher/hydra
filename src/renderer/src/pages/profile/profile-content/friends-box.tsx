import { userProfileContext } from "@renderer/context";
import { useFormat } from "@renderer/hooks";
import { useContext } from "react";
import { useTranslation } from "react-i18next";

import * as styles from "./profile-content.css";
import { Link } from "@renderer/components";

export function FriendsBox() {
  const { userProfile, userStats } = useContext(userProfileContext);

  const { t } = useTranslation("user_profile");

  const { numberFormatter } = useFormat();

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
                <img
                  src={friend.profileImageUrl!}
                  alt={friend.displayName}
                  className={styles.listItemImage}
                />
                <span className={styles.friendName}>{friend.displayName}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
