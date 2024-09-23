import { useNavigate } from "react-router-dom";
import { PeopleIcon, PersonIcon } from "@primer/octicons-react";
import * as styles from "./sidebar-profile.css";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";

const LONG_POLLING_INTERVAL = 60_000;

export function SidebarProfile() {
  const navigate = useNavigate();

  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

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
    pollingInterval.current = setInterval(() => {
      syncFriendRequests();
    }, LONG_POLLING_INTERVAL);

    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
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
