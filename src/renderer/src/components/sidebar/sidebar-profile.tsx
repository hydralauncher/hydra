import { useNavigate } from "react-router-dom";
import {
  BellIcon,
  ChevronDownIcon,
  PeopleIcon,
  PersonIcon,
  SignOutIcon,
} from "@primer/octicons-react";
import { useAppSelector, useToast, useUserDetails } from "@renderer/hooks";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { Avatar } from "../avatar/avatar";
import { AuthPage } from "@shared";
import { logger } from "@renderer/logger";
import type { NotificationCountResponse, ProfileFriends } from "@types";
import { useDispatch } from "react-redux";
import { setFriendRequestCount } from "@renderer/features/user-details-slice";
import "./sidebar-profile.scss";

export function SidebarProfile() {
  const navigate = useNavigate();
  const dispatch = useDispatch();

  const { t } = useTranslation(["sidebar", "user_profile"]);

  const { userDetails, signOut } = useUserDetails();
  const { showSuccessToast } = useToast();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const [notificationCount, setNotificationCount] = useState(0);
  const [onlineFriendsCount, setOnlineFriendsCount] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isDropdownClosing, setIsDropdownClosing] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const apiNotificationCountRef = useRef(0);
  const hasFetchedInitialCount = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLocalNotificationCount = useCallback(async () => {
    try {
      const localCount = await window.electron.getLocalNotificationsCount();
      setNotificationCount(localCount + apiNotificationCountRef.current);
    } catch (error) {
      logger.error("Failed to fetch local notification count", error);
    }
  }, []);

  const fetchApiNotificationCount = useCallback(async () => {
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
    fetchLocalNotificationCount();
  }, [fetchLocalNotificationCount]);

  useEffect(() => {
    fetchLocalNotificationCount();
  }, [fetchLocalNotificationCount]);

  useEffect(() => {
    if (userDetails && !hasFetchedInitialCount.current) {
      hasFetchedInitialCount.current = true;
      fetchApiNotificationCount();
    } else if (!userDetails) {
      hasFetchedInitialCount.current = false;
      apiNotificationCountRef.current = 0;
      fetchLocalNotificationCount();
    }
  }, [userDetails, fetchApiNotificationCount, fetchLocalNotificationCount]);

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

  const updateOnlineFriendsCount = useCallback(async () => {
    if (!userDetails) {
      setOnlineFriendsCount(0);
      return;
    }
    try {
      const response =
        await globalThis.window.electron.hydraApi.get<ProfileFriends>(
          "/profile/friends",
          { params: { take: 5, skip: 0 } }
        );
      setOnlineFriendsCount(response.onlineFriends);
    } catch {
      // ignore transient errors
    }
  }, [userDetails]);

  useEffect(() => {
    updateOnlineFriendsCount();

    const unsubscribeFriends = globalThis.window.electron.onFriendsUpdated(
      () => {
        updateOnlineFriendsCount();
      }
    );

    let interval: ReturnType<typeof setInterval> | null = null;
    const unsubscribePresence =
      typeof globalThis.window.electron.onFriendPresence === "function"
        ? globalThis.window.electron.onFriendPresence(() => {
            updateOnlineFriendsCount();
          })
        : () => {
            if (interval) clearInterval(interval);
          };

    if (typeof globalThis.window.electron.onFriendPresence !== "function") {
      interval = setInterval(updateOnlineFriendsCount, 30_000);
    }

    return () => {
      unsubscribeFriends();
      unsubscribePresence();
    };
  }, [updateOnlineFriendsCount]);

  useEffect(() => {
    const unsubscribe = globalThis.window.electron.onSyncFriendRequests(
      (result) => {
        dispatch(setFriendRequestCount(result.friendRequestCount));
      }
    );
    return () => unsubscribe();
  }, [dispatch]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  const closeDropdown = () => {
    setIsDropdownClosing(true);
    setTimeout(() => {
      setDropdownOpen(false);
      setIsDropdownClosing(false);
    }, 150);
  };

  const handleProfileClick = () => {
    if (userDetails === null) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }
    if (dropdownOpen) {
      closeDropdown();
    } else {
      setDropdownOpen(true);
    }
  };

  const handleViewProfile = () => {
    if (!userDetails) return;
    closeDropdown();
    navigate(`/profile/${userDetails.id}`);
  };

  const handleNotificationsClick = () => {
    closeDropdown();
    navigate("/notifications");
  };

  const handleFriendsClick = () => {
    closeDropdown();
    globalThis.window.electron.openFriendsWindow();
  };

  const handleSignOut = async () => {
    setIsSigningOut(true);
    closeDropdown();
    try {
      await signOut();
      showSuccessToast(t("user_profile:successfully_signed_out"));
    } finally {
      setIsSigningOut(false);
    }
    navigate("/");
  };

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
    <div className="sidebar-profile" ref={containerRef}>
      <button
        type="button"
        className={`sidebar-profile__button${dropdownOpen ? " sidebar-profile__button--active" : ""}`}
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

          {userDetails && (
            <ChevronDownIcon
              size={12}
              className={`sidebar-profile__chevron${dropdownOpen ? " sidebar-profile__chevron--open" : ""}`}
            />
          )}
        </div>
      </button>

      {dropdownOpen && userDetails && (
        <div
          className={`sidebar-profile__dropdown${isDropdownClosing ? " sidebar-profile__dropdown--closing" : ""}`}
        >
          <button
            type="button"
            className="sidebar-profile__dropdown-item"
            onClick={handleViewProfile}
          >
            <PersonIcon size={16} />
            <span>{t("user_profile:see_profile")}</span>
          </button>

          <button
            type="button"
            className="sidebar-profile__dropdown-item"
            onClick={handleNotificationsClick}
          >
            <BellIcon size={16} />
            <span>{t("notifications")}</span>
            {notificationCount > 0 && (
              <small className="sidebar-profile__dropdown-badge">
                {notificationCount > 99 ? "99+" : notificationCount}
              </small>
            )}
          </button>

          <button
            type="button"
            className="sidebar-profile__dropdown-item"
            onClick={handleFriendsClick}
          >
            <PeopleIcon size={16} />
            <span>{t("friends")}</span>
            {onlineFriendsCount > 0 && (
              <small className="sidebar-profile__dropdown-badge sidebar-profile__dropdown-badge--online">
                {onlineFriendsCount}
              </small>
            )}
          </button>

          <div className="sidebar-profile__dropdown-separator" />

          <button
            type="button"
            className="sidebar-profile__dropdown-item sidebar-profile__dropdown-item--danger"
            onClick={handleSignOut}
            disabled={isSigningOut}
          >
            <SignOutIcon size={16} />
            <span>{t("user_profile:sign_out")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
