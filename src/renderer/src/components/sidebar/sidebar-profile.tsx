import { useNavigate } from "react-router-dom";
import { PeopleIcon, PersonIcon } from "@primer/octicons-react";
import * as styles from "./sidebar-profile.css";
import { useUserDetails } from "@renderer/hooks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";

export function SidebarProfile() {
  const navigate = useNavigate();

  const { t } = useTranslation("sidebar");

  const { userDetails, friendRequests, showFriendsModal } = useUserDetails();

  const receivedRequests = useMemo(() => {
    return friendRequests.filter((request) => request.type === "RECEIVED");
  }, [friendRequests]);

  const handleProfileClick = () => {
    if (userDetails === null) {
      window.electron.openAuthWindow();
      return;
    }

    navigate(`/profile/${userDetails!.id}`);
  };

  const friendsButton = useMemo(() => {
    if (!userDetails) return null;

    return (
      <button
        type="button"
        className={styles.friendsButton}
        onClick={() =>
          showFriendsModal(UserFriendModalTab.AddFriend, userDetails.id)
        }
        title={t("friends")}
      >
        {receivedRequests.length > 0 && (
          <small className={styles.friendsButtonBadge}>
            {receivedRequests.length > 99 ? "99+" : receivedRequests.length}
          </small>
        )}

        <PeopleIcon size={16} />
      </button>
    );
  }, [userDetails, t, receivedRequests, showFriendsModal]);

  return (
    <div className={styles.profileContainer}>
      <button
        type="button"
        className={styles.profileButton}
        onClick={handleProfileClick}
      >
        <div className={styles.profileButtonContent}>
          <div className={styles.profileAvatar}>
            {userDetails?.profileImageUrl ? (
              <img
                className={styles.profileAvatar}
                src={userDetails.profileImageUrl}
                alt={userDetails.displayName}
              />
            ) : (
              <PersonIcon size={24} />
            )}
          </div>

          <div className={styles.profileButtonInformation}>
            <p className={styles.profileButtonTitle}>
              {userDetails ? userDetails.displayName : t("sign_in")}
            </p>

            {userDetails && userDetails.currentGame && (
              <div>
                <small>{userDetails.currentGame.title}</small>
              </div>
            )}
          </div>

          {userDetails && userDetails.currentGame && (
            <img
              alt={userDetails.currentGame.title}
              width={24}
              style={{ borderRadius: 4 }}
              src={userDetails.currentGame.iconUrl!}
            />
          )}
        </div>
      </button>

      {friendsButton}
    </div>
  );
}
