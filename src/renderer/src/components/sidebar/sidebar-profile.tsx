import { useNavigate } from "react-router-dom";
import { PersonAddIcon, PersonIcon } from "@primer/octicons-react";
import * as styles from "./sidebar-profile.css";
import { assignInlineVars } from "@vanilla-extract/dynamic";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { profileContainerBackground } from "./sidebar-profile.css";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";

export function SidebarProfile() {
  const navigate = useNavigate();

  const { t } = useTranslation("sidebar");

  const {
    userDetails,
    profileBackground,
    friendRequests,
    setShowFriendsModal,
  } = useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const handleButtonClick = () => {
    if (userDetails === null) {
      window.electron.openAuthWindow();
      return;
    }

    navigate(`/user/${userDetails!.id}`);
  };

  const profileButtonBackground = useMemo(() => {
    if (profileBackground) return profileBackground;
    return undefined;
  }, [profileBackground]);

  return (
    <div
      className={styles.profileContainer}
      style={assignInlineVars({
        [profileContainerBackground]: profileButtonBackground,
      })}
    >
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

          {userDetails && gameRunning && (
            <img
              alt={gameRunning.title}
              width={24}
              style={{ borderRadius: 4 }}
              src={gameRunning.iconUrl}
            />
          )}
        </div>
      </button>
      {userDetails && friendRequests.length > 0 && !gameRunning && (
        <div className={styles.friendRequestContainer}>
          <button
            type="button"
            className={styles.friendRequestButton}
            onClick={() =>
              setShowFriendsModal(true, UserFriendModalTab.AddFriend)
            }
          >
            <PersonAddIcon size={24} />
            {friendRequests.length}
          </button>
        </div>
      )}
    </div>
  );
}
