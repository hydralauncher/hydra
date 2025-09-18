import { useNavigate } from "react-router-dom";
import { PeopleIcon } from "@primer/octicons-react";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { UserFriendModalTab } from "@renderer/pages/shared-modals/user-friend-modal";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { Avatar } from "../avatar/avatar";
import { AuthPage } from "@shared";
import "./sidebar-profile.scss";

export function SidebarProfile() {
  const navigate = useNavigate();

  const { t } = useTranslation("sidebar");

  const { userDetails, friendRequestCount, showFriendsModal } =
    useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const handleProfileClick = () => {
    if (userDetails === null) {
      if (window.electron) {
        window.electron.openAuthWindow(AuthPage.SignIn);
      }
      return;
    }

    navigate(`/profile/${userDetails.id}`);
  };

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

      {friendsButton}
    </div>
  );
}
