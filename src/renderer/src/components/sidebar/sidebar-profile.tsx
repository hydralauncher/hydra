import { useNavigate } from "react-router-dom";
import { BellIcon } from "@primer/octicons-react";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { Avatar } from "../avatar/avatar";
import { AuthPage } from "@shared";
import { logger } from "@renderer/logger";
import type { NotificationCountResponse } from "@types";
import "./sidebar-profile.scss";

const NOTIFICATION_POLL_INTERVAL_MS = 5 * 60 * 1000;

export function SidebarProfile() {
  const navigate = useNavigate();

  const { t } = useTranslation("sidebar");

  const { userDetails } = useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const [notificationCount, setNotificationCount] = useState(0);
  const apiNotificationCountRef = useRef(0);
  const userDetailsRef = useRef(userDetails);

  // Keep userDetailsRef in sync
  useEffect(() => {
    userDetailsRef.current = userDetails;
  }, [userDetails]);

  const fetchLocalNotificationCount = useCallback(async () => {
    try {
      const localCount = await window.electron.getLocalNotificationsCount();
      setNotificationCount(localCount + apiNotificationCountRef.current);
    } catch (error) {
      logger.error("Failed to fetch local notification count", error);
    }
  }, []);

  const fetchFullNotificationCount = useCallback(async () => {
    try {
      const localCount = await window.electron.getLocalNotificationsCount();

      if (userDetailsRef.current) {
        try {
          const response =
            await window.electron.hydraApi.get<NotificationCountResponse>(
              "/profile/notifications/count",
              { needsAuth: true }
            );
          apiNotificationCountRef.current = response.count;
        } catch {
          // Ignore API errors
        }
      } else {
        apiNotificationCountRef.current = 0;
      }

      setNotificationCount(localCount + apiNotificationCountRef.current);
    } catch (error) {
      logger.error("Failed to fetch notification count", error);
    }
  }, []);

  useEffect(() => {
    fetchFullNotificationCount();

    const interval = setInterval(
      fetchFullNotificationCount,
      NOTIFICATION_POLL_INTERVAL_MS
    );
    return () => clearInterval(interval);
  }, [fetchFullNotificationCount]);

  useEffect(() => {
    if (userDetails) {
      fetchFullNotificationCount();
    } else {
      apiNotificationCountRef.current = 0;
      fetchLocalNotificationCount();
    }
  }, [userDetails, fetchFullNotificationCount, fetchLocalNotificationCount]);

  useEffect(() => {
    const unsubscribe = window.electron.onLocalNotificationCreated(() => {
      fetchLocalNotificationCount();
    });

    return () => unsubscribe();
  }, [fetchLocalNotificationCount]);

  useEffect(() => {
    const handleNotificationsChange = () => {
      fetchLocalNotificationCount();
    };

    window.addEventListener("notificationsChanged", handleNotificationsChange);
    return () => {
      window.removeEventListener(
        "notificationsChanged",
        handleNotificationsChange
      );
    };
  }, [fetchLocalNotificationCount]);

  useEffect(() => {
    const unsubscribe = window.electron.onSyncNotificationCount(
      (notification) => {
        apiNotificationCountRef.current = notification.notificationCount;
        fetchLocalNotificationCount();
      }
    );

    return () => unsubscribe();
  }, [fetchLocalNotificationCount]);

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
    </div>
  );
}
