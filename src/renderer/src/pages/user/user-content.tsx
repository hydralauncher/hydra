import { UserGame, UserProfile } from "@types";
import cn from "classnames";
import * as styles from "./user.css";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import {
  useAppSelector,
  useDate,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import {
  buildGameDetailsPath,
  profileBackgroundFromProfileImage,
  steamUrlBuilder,
} from "@renderer/helpers";
import {
  CheckCircleIcon,
  PersonIcon,
  PlusIcon,
  TelescopeIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import { Button, Link } from "@renderer/components";
import { UserEditProfileModal } from "./user-edit-modal";
import { UserSignOutModal } from "./user-signout-modal";
import { UserFriendModalTab } from "../shared-modals/user-friend-modal";

const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;

export interface ProfileContentProps {
  userProfile: UserProfile;
  updateUserProfile: () => Promise<void>;
}

export function UserContent({
  userProfile,
  updateUserProfile,
}: ProfileContentProps) {
  const { t, i18n } = useTranslation("user_profile");

  const {
    userDetails,
    profileBackground,
    friendRequests,
    signOut,
    fetchFriendRequests,
    showFriendsModal,
    updateFriendRequestState,
  } = useUserDetails();
  const { showSuccessToast, showErrorToast } = useToast();

  const [profileContentBoxBackground, setProfileContentBoxBackground] =
    useState<string | undefined>();
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const navigate = useNavigate();

  const numberFormatter = useMemo(() => {
    return new Intl.NumberFormat(i18n.language, {
      maximumFractionDigits: 0,
    });
  }, [i18n.language]);

  const { formatDistance, formatDiffInMillis } = useDate();

  const formatPlayTime = () => {
    const seconds = userProfile.totalPlayTimeInSeconds;
    const minutes = seconds / 60;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", {
        amount: minutes.toFixed(0),
      });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  };

  const handleGameClick = (game: UserGame) => {
    navigate(buildGameDetailsPath(game));
  };

  const handleEditProfile = () => {
    setShowEditProfileModal(true);
  };

  const handleOnClickFriend = (userId: string) => {
    navigate(`/user/${userId}`);
  };

  const handleConfirmSignout = async () => {
    await signOut();

    showSuccessToast(t("successfully_signed_out"));

    navigate("/");
  };

  const isMe = userDetails?.id == userProfile.id;

  useEffect(() => {
    if (isMe) fetchFriendRequests();
  }, [isMe]);

  useEffect(() => {
    if (isMe && profileBackground) {
      setProfileContentBoxBackground(profileBackground);
    }

    if (userProfile.profileImageUrl) {
      profileBackgroundFromProfileImage(userProfile.profileImageUrl).then(
        (profileBackground) => {
          setProfileContentBoxBackground(profileBackground);
        }
      );
    }
  }, [profileBackground, isMe]);

  const handleCancelFriendRequest = (userId: string) => {
    updateFriendRequestState(userId, "CANCEL").catch(() => {
      showErrorToast("Falha ao cancelar convite");
    });
  };

  const handleAcceptFriendRequest = (userId: string) => {
    updateFriendRequestState(userId, "ACCEPTED").catch(() => {
      showErrorToast("Falha ao aceitar convite");
    });
  };

  const handleRefuseFriendRequest = (userId: string) => {
    updateFriendRequestState(userId, "REFUSED").catch(() => {
      showErrorToast("Falha ao recusar convite");
    });
  };

  const getProfileActions = () => {
    if (isMe) {
      return (
        <>
          <Button theme="outline" onClick={handleEditProfile}>
            {t("edit_profile")}
          </Button>

          <Button theme="danger" onClick={() => setShowSignOutModal(true)}>
            {t("sign_out")}
          </Button>
        </>
      );
    }

    const friendRequest = friendRequests.find(
      (request) => request.id == userProfile.id
    );

    if (!friendRequest) {
      return (
        <>
          <Button theme="outline" onClick={() => {}}>
            {t("add_friend")}
          </Button>

          <Button theme="danger" onClick={() => {}}>
            {t("block_user")}
          </Button>
        </>
      );
    }

    if (friendRequest.type === "RECEIVED") {
      return (
        <>
          <Button
            theme="outline"
            className={styles.acceptRequestButton}
            onClick={() => handleAcceptFriendRequest(friendRequest.id)}
          >
            <CheckCircleIcon size={28} /> {t("accept_request")}
          </Button>
          <Button
            theme="outline"
            className={styles.cancelRequestButton}
            onClick={() => handleRefuseFriendRequest(friendRequest.id)}
          >
            <XCircleIcon size={28} /> {t("ignore_request")}
          </Button>
        </>
      );
    }

    return (
      <Button
        theme="outline"
        className={styles.cancelRequestButton}
        onClick={() => handleCancelFriendRequest(friendRequest.id)}
      >
        <XCircleIcon size={28} /> {t("cancel_request")}
      </Button>
    );
  };

  return (
    <>
      <UserEditProfileModal
        visible={showEditProfileModal}
        onClose={() => setShowEditProfileModal(false)}
        updateUserProfile={updateUserProfile}
        userProfile={userProfile}
      />

      <UserSignOutModal
        visible={showSignOutModal}
        onClose={() => setShowSignOutModal(false)}
        onConfirm={handleConfirmSignout}
      />

      <section
        className={styles.profileContentBox}
        style={{
          padding: `${SPACING_UNIT * 3}px ${SPACING_UNIT * 2}px`,
          position: "relative",
        }}
      >
        {gameRunning && isMe && (
          <img
            src={steamUrlBuilder.libraryHero(gameRunning.objectID)}
            alt={gameRunning.title}
            className={styles.profileBackground}
          />
        )}

        <div
          style={{
            background: profileContentBoxBackground,
            position: "absolute",
            inset: 0,
            borderRadius: "4px",
          }}
        ></div>

        <div className={styles.profileAvatarContainer}>
          {userProfile.profileImageUrl ? (
            <img
              className={styles.profileAvatar}
              alt={userProfile.displayName}
              src={userProfile.profileImageUrl}
            />
          ) : (
            <PersonIcon size={72} />
          )}
        </div>

        <div className={styles.profileInformation}>
          <h2 style={{ fontWeight: "bold" }}>{userProfile.displayName}</h2>
          {isMe && gameRunning && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: `${SPACING_UNIT / 2}px`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  gap: `${SPACING_UNIT}px`,
                  alignItems: "center",
                }}
              >
                <Link to={buildGameDetailsPath(gameRunning)}>
                  {gameRunning.title}
                </Link>
              </div>
              <small>
                {t("playing_for", {
                  amount: formatDiffInMillis(
                    gameRunning.sessionDurationInMillis,
                    new Date()
                  ),
                })}
              </small>
            </div>
          )}
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            justifyContent: "end",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: `${SPACING_UNIT}px`,
            }}
          >
            {getProfileActions()}
          </div>
        </div>
      </section>

      <div className={styles.profileContent}>
        <div className={styles.profileGameSection}>
          <h2>{t("activity")}</h2>

          {!userProfile.recentGames.length ? (
            <div className={styles.noDownloads}>
              <div className={styles.telescopeIcon}>
                <TelescopeIcon size={24} />
              </div>
              <h2>{t("no_recent_activity_title")}</h2>
              {isMe && (
                <p style={{ fontFamily: "Fira Sans" }}>
                  {t("no_recent_activity_description")}
                </p>
              )}
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: `${SPACING_UNIT * 2}px`,
              }}
            >
              {userProfile.recentGames.map((game) => (
                <button
                  key={game.objectID}
                  className={cn(styles.feedItem, styles.profileContentBox)}
                  onClick={() => handleGameClick(game)}
                >
                  <img
                    className={styles.feedGameIcon}
                    src={game.cover}
                    alt={game.title}
                  />
                  <div className={styles.gameInformation}>
                    <h4>{game.title}</h4>
                    <small>
                      {t("last_time_played", {
                        period: formatDistance(
                          game.lastTimePlayed!,
                          new Date(),
                          {
                            addSuffix: true,
                          }
                        ),
                      })}
                    </small>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={styles.contentSidebar}>
          <div className={styles.profileGameSection}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: `${SPACING_UNIT * 2}px`,
              }}
            >
              <h2>{t("library")}</h2>

              <div
                style={{
                  flex: 1,
                  backgroundColor: vars.color.border,
                  height: "1px",
                }}
              />
              <h3 style={{ fontWeight: "400" }}>
                {userProfile.libraryGames.length}
              </h3>
            </div>
            <small>{t("total_play_time", { amount: formatPlayTime() })}</small>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: `${SPACING_UNIT}px`,
              }}
            >
              {userProfile.libraryGames.map((game) => (
                <button
                  key={game.objectID}
                  className={cn(styles.gameListItem, styles.profileContentBox)}
                  onClick={() => handleGameClick(game)}
                  title={game.title}
                >
                  {game.iconUrl ? (
                    <img
                      className={styles.libraryGameIcon}
                      src={game.iconUrl}
                      alt={game.title}
                    />
                  ) : (
                    <SteamLogo className={styles.libraryGameIcon} />
                  )}
                </button>
              ))}
            </div>
          </div>

          {(isMe ||
            (userProfile.friends && userProfile.friends.totalFriends > 0)) && (
            <div className={styles.friendsSection}>
              <button
                className={styles.friendsSectionHeader}
                onClick={() => showFriendsModal(UserFriendModalTab.FriendsList)}
              >
                <h2>{t("friends")}</h2>

                <div
                  style={{
                    flex: 1,
                    backgroundColor: vars.color.border,
                    height: "1px",
                  }}
                />
                <h3 style={{ fontWeight: "400" }}>
                  {userProfile.friends.totalFriends}
                </h3>
              </button>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: `${SPACING_UNIT}px`,
                }}
              >
                {userProfile.friends.friends.map((friend) => {
                  return (
                    <button
                      key={friend.id}
                      className={cn(
                        styles.profileContentBox,
                        styles.friendListContainer
                      )}
                      onClick={() => handleOnClickFriend(friend.id)}
                    >
                      <div className={styles.friendAvatarContainer}>
                        {friend.profileImageUrl ? (
                          <img
                            className={styles.friendProfileIcon}
                            src={friend.profileImageUrl}
                            alt={friend.displayName}
                          />
                        ) : (
                          <PersonIcon size={24} />
                        )}
                      </div>

                      <p className={styles.friendListDisplayName}>
                        {friend.displayName}
                      </p>
                    </button>
                  );
                })}

                {isMe && (
                  <Button
                    theme="outline"
                    onClick={() =>
                      showFriendsModal(UserFriendModalTab.AddFriend)
                    }
                  >
                    <PlusIcon /> {t("add")}
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
