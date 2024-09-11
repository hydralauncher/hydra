import { useNavigate } from "react-router-dom";
import { PeopleIcon, PersonIcon } from "@primer/octicons-react";
import * as styles from "./sidebar-profile.css";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import { FriendRequest } from "@types";

export function SidebarProfile() {
  const navigate = useNavigate();

  const { t } = useTranslation("sidebar");

  const { userDetails, friendRequests, showFriendsModal } = useUserDetails();

  const [receivedRequests, setReceivedRequests] = useState<FriendRequest[]>([]);

  useEffect(() => {
    setReceivedRequests(
      friendRequests.filter((request) => request.type === "RECEIVED")
    );
  }, [friendRequests]);

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const handleButtonClick = () => {
    if (userDetails === null) {
      window.electron.openAuthWindow();
      return;
    }

    navigate(`/profile/${userDetails!.id}`);
  };

  return (
    <div className={styles.profileContainer}>
      <button
        type="button"
        className={styles.profileButton}
        onClick={handleButtonClick}
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

            {userDetails && gameRunning && (
              <div>
                <small>{gameRunning.title}</small>
              </div>
            )}
          </div>

          {userDetails && gameRunning?.iconUrl && (
            <img
              alt={gameRunning.title}
              width={24}
              style={{ borderRadius: 4 }}
              src={gameRunning.iconUrl}
            />
          )}
        </div>
      </button>

      <button
        type="button"
        className={styles.friendsButton}
        onClick={() =>
          showFriendsModal(UserFriendModalTab.AddFriend, userDetails.id)
        }
      >
        <small className={styles.friendsButtonLabel}>10</small>

        <PeopleIcon size={16} />
      </button>
    </div>
  );
}
