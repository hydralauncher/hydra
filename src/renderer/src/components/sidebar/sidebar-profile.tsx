import { useNavigate } from "react-router-dom";
import { PeopleIcon, BellIcon } from "@primer/octicons-react";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { Avatar } from "../avatar/avatar";
import { AuthPage } from "@shared";
import { logger } from "@renderer/logger";
import type { NotificationCountResponse } from "@types";
import "./sidebar-profile.scss";

export function SidebarProfile() {
  const navigate = useNavigate();

  const { t } = useTranslation("sidebar");

  const { userDetails, friendRequestCount, showFriendsModal } =
    useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const [notificationCount, setNotificationCount] = useState(0);

  const fetchNotificationCount = useCallback(async () => {
    try {
      // Always fetch local notification count
      const localCount = await window.electron.getLocalNotificationsCount();

      // Fetch API notification count only if logged in
      let apiCount = 0;
      if (userDetails) {
        try {
          const response =
            await window.electron.hydraApi.get<NotificationCountResponse>(
              "/profile/notifications/count",
              { needsAuth: true }
            );
          apiCount = response.count;
        } catch {
          // Ignore API errors
        }
      }

      setNotificationCount(localCount + apiCount);
    } catch (error) {
      logger.error("Failed to fetch notification count", error);
    }
  }, [userDetails]);

  useEffect(() => {
    fetchNotificationCount();

    const interval = setInterval(fetchNotificationCount, 60000);
    return () => clearInterval(interval);
  }, [fetchNotificationCount]);

  useEffect(() => {
    const unsubscribe = window.electron.onLocalNotificationCreated(() => {
      fetchNotificationCount();
    });

    return () => unsubscribe();
  }, [fetchNotificationCount]);

  useEffect(() => {
    const handleNotificationsChange = () => {
      fetchNotificationCount();
    };

    window.addEventListener("notificationsChanged", handleNotificationsChange);
    return () => {
      window.removeEventListener(
        "notificationsChanged",
        handleNotificationsChange
      );
    };
  }, [fetchNotificationCount]);

  useEffect(() => {
    const unsubscribe = window.electron.onSyncNotificationCount(() => {
      fetchNotificationCount();
    });

    return () => unsubscribe();
  }, [fetchNotificationCount]);

  const handleProfileClick = () => {
    if (userDetails === null) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }

    navigate(`/profile/${userDetails.id}`);
  };

  const notificationsButton = useMemo(() => {
    return (
      <button
        type="button"
        className="sidebar-profile__notification-button"
        onClick={() => navigate("/notifications")}
        title={t("notifications")}
      >
        {notificationCount > 0 && (
          <small className="sidebar-profile__notification-button-badge">
            {notificationCount > 99 ? "99+" : notificationCount}
          </small>
        )}

        <BellIcon size={16} />
      </button>
    );
  }, [t, notificationCount, navigate]);

  const friendsButton = useMemo(() => {
    if (!userDetails) return null;

    return (
      <button
        type="button"
        className="sidebar-profile__friends-button"
        onClick={() =>
          showFriendsModal(UserFriendModalTab.AddFriend, userDetails.id)
        }
        title={t("friends")}
      >
        {friendRequestCount > 0 && (
          <small className="sidebar-profile__friends-button-badge">
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
          className="sidebar-profile__game-running-icon"
          alt={gameRunning.title}
          width={24}
          src={gameRunning.iconUrl}
        />
      );
    }

    return <SteamLogo />;
  };

  return (
    <div className="sidebar-profile">
      <button
        type="button"
        className="sidebar-profile__button"
        onClick={handleProfileClick}
      >
        <div className="sidebar-profile__button-content">
          <Avatar
            size={35}
            src={userDetails?.profileImageUrl}
            alt={userDetails?.displayName}
          />

          <div className="sidebar-profile__button-information">
            <p className="sidebar-profile__button-title">
              {userDetails ? userDetails.displayName : t("sign_in")}
            </p>

            {userDetails && gameRunning && (
              <div className="sidebar-profile__button-game-running-title">
                <small>{gameRunning.title}</small>
              </div>
            )}
          </div>

          {gameRunningDetails()}
        </div>
      </button>

      {notificationsButton}
      {friendsButton}
    </div>
  );
}
