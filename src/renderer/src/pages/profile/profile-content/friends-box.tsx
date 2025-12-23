import { userProfileContext } from "@renderer/context";
import { useUserDetails } from "@renderer/hooks";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { PlusIcon } from "@primer/octicons-react";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import { Avatar, Link } from "@renderer/components";
import { AllFriendsModal } from "./all-friends-modal";
import { AddFriendModal } from "./add-friend-modal";
import "./friends-box.scss";

export function FriendsBox() {
  const { userProfile } = useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const [showAllFriendsModal, setShowAllFriendsModal] = useState(false);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);

  const isMe = userDetails?.id === userProfile?.id;

  const getGameImage = (game: { iconUrl: string | null; title: string }) => {
    if (game.iconUrl) {
      return (
        <img
          className="friends-box__game-image"
          alt={game.title}
          width={16}
          src={game.iconUrl}
        />
      );
    }

    return <SteamLogo width={16} height={16} />;
  };

  if (!userProfile?.friends.length) return null;

  return (
    <>
      <div className="friends-box__box">
        <ul className="friends-box__list">
          {userProfile?.friends.map((friend) => (
            <li
              key={friend.id}
              title={
                friend.currentGame
                  ? t("playing", { game: friend.currentGame.title })
                  : undefined
              }
            >
              <Link
                to={`/profile/${friend.id}`}
                className="friends-box__list-item"
              >
                <Avatar
                  size={32}
                  src={friend.profileImageUrl}
                  alt={friend.displayName}
                />

                <div className="friends-box__friend-details">
                  <span className="friends-box__friend-name">
                    {friend.displayName}
                  </span>
                  {friend.currentGame && (
                    <div className="friends-box__game-info">
                      {getGameImage(friend.currentGame)}
                      <small>{friend.currentGame.title}</small>
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <div className="friends-box__view-all-container">
          <button
            type="button"
            className="friends-box__view-all"
            onClick={() => setShowAllFriendsModal(true)}
          >
            {t("view_all")}
          </button>
        </div>
      </div>

      {userProfile && (
        <>
          <AllFriendsModal
            visible={showAllFriendsModal}
            onClose={() => setShowAllFriendsModal(false)}
            userId={userProfile.id}
            isMe={isMe}
          />
          <AddFriendModal
            visible={showAddFriendModal}
            onClose={() => setShowAddFriendModal(false)}
          />
        </>
      )}
    </>
  );
}

export function FriendsBoxAddButton() {
  const { userProfile } = useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);

  const isMe = userDetails?.id === userProfile?.id;

  if (!isMe) return null;

  return (
    <>
      <button
        type="button"
        className="friends-box__add-friend-button"
        onClick={() => setShowAddFriendModal(true)}
      >
        <PlusIcon size={16} />
        {t("add_friends")}
      </button>
      <AddFriendModal
        visible={showAddFriendModal}
        onClose={() => setShowAddFriendModal(false)}
      />
    </>
  );
}
