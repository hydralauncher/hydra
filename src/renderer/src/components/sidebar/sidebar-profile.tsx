import { useNavigate } from "react-router-dom";
import { PeopleIcon } from "@primer/octicons-react";
import * as styles from "./sidebar-profile.css";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { Avatar } from "../avatar/avatar";

const LONG_POLLING_INTERVAL = 60_000;

export function SidebarProfile() {
  const navigate = useNavigate();

  const { t } = useTranslation("sidebar");

  const {
    userDetails,
    friendRequestCount,
    showFriendsModal,
    syncFriendRequests,
  } = useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const handleProfileClick = () => {
    if (userDetails === null) {
      window.electron.openAuthWindow();
      return;
    }

    navigate(`/profile/${userDetails!.id}`);
  };

  useEffect(() => {
    const pollingInterval = setInterval(() => {
      syncFriendRequests();
    }, LONG_POLLING_INTERVAL);

    return () => {
      clearInterval(pollingInterval);
    };
  }, [syncFriendRequests]);

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
        {friendRequestCount > 0 && (
          <small className={styles.friendsButtonBadge}>
            {friendRequestCount > 99 ? "99+" : friendRequestCount}
          </small>
        )}

        <PeopleIcon size={16} />
      </button>
    );
  }, [userDetails, t, friendRequestCount, showFriendsModal]);

  const gameRunningDetails = () => {
    if (!userDetails || !gameRunning) return null;

    if (gameRunning.iconUrl) {
      return (
        <img
          alt={gameRunning.title}
          width={24}
          style={{ borderRadius: 4 }}
          src={gameRunning.iconUrl}
        />
      );
    }

    return <SteamLogo />;
  };

  return (
    <div className={styles.profileContainer}>
      <button
        type="button"
        className={styles.profileButton}
        onClick={handleProfileClick}
      >
        <div className={styles.profileButtonContent}>
          <Avatar
            size={35}
            src={userDetails?.profileImageUrl}
            alt={userDetails?.displayName}
          />

          <div className={styles.profileButtonInformation}>
            <p className={styles.profileButtonTitle}>
              {userDetails ? userDetails.displayName : t("sign_in")}
            </p>

            {userDetails && gameRunning && (
              <div
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                  textAlign: "left",
                }}
              >
                <small>{gameRunning.title}</small>
              </div>
            )}
          </div>

          {gameRunningDetails()}
        </div>
      </button>

      {friendsButton}
    </div>
  );
}
