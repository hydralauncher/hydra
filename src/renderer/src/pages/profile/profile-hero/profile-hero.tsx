import "./profile-hero.scss";

import { useCallback, useContext, useMemo, useState } from "react";
import { userProfileContext } from "@renderer/context";
import {
  BlockedIcon,
  CheckCircleFillIcon,
  PencilIcon,
  PersonAddIcon,
  SignOutIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { buildGameDetailsPath } from "@renderer/helpers";
import { Avatar, Button, Link } from "@renderer/components";
import { useTranslation } from "react-i18next";
import {
  useAppSelector,
  useDate,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { addSeconds } from "date-fns";
import { useNavigate } from "react-router-dom";

import type { FriendRequestAction } from "@types";
import { EditProfileModal } from "../edit-profile-modal/edit-profile-modal";
import Skeleton from "react-loading-skeleton";
import { UploadBackgroundImageButton } from "../upload-background-image-button/upload-background-image-button";

type FriendAction =
  | FriendRequestAction
  | ("BLOCK" | "UNDO_FRIENDSHIP" | "SEND");

const backgroundImageLayer =
  "linear-gradient(135deg, rgb(0 0 0 / 40%), rgb(0 0 0 / 30%))";

export function ProfileHero() {
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [isPerformingAction, setIsPerformingAction] = useState(false);

  const { isMe, getUserProfile, userProfile, heroBackground, backgroundImage } =
    useContext(userProfileContext);
  const {
    signOut,
    updateFriendRequestState,
    sendFriendRequest,
    undoFriendship,
    blockUser,
  } = useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const { t } = useTranslation("user_profile");
  const { formatDistance } = useDate();

  const { showSuccessToast, showErrorToast } = useToast();

  const navigate = useNavigate();

  const handleSignOut = useCallback(async () => {
    setIsPerformingAction(true);

    try {
      await signOut();

      showSuccessToast(t("successfully_signed_out"));
    } finally {
      setIsPerformingAction(false);
    }
    navigate("/");
  }, [navigate, signOut, showSuccessToast, t]);

  const handleFriendAction = useCallback(
    async (userId: string, action: FriendAction) => {
      if (!userProfile) return;
      setIsPerformingAction(true);

      try {
        if (action === "UNDO_FRIENDSHIP") {
          await undoFriendship(userId).then(getUserProfile);
          return;
        }

        if (action === "BLOCK") {
          await blockUser(userId).then(() => {
            showSuccessToast(t("user_blocked_successfully"));
            navigate(-1);
          });

          return;
        }

        if (action === "SEND") {
          await sendFriendRequest(userProfile.id).then(getUserProfile);
          return;
        }

        await updateFriendRequestState(userId, action).then(getUserProfile);
      } catch (err) {
        showErrorToast(t("try_again"));
      } finally {
        setIsPerformingAction(false);
      }
    },
    [
      undoFriendship,
      blockUser,
      sendFriendRequest,
      updateFriendRequestState,
      t,
      showErrorToast,
      getUserProfile,
      navigate,
      showSuccessToast,
      userProfile,
    ]
  );

  const profileActions = useMemo(() => {
    if (!userProfile) return null;

    if (isMe) {
      return (
        <>
          <Button
            theme="outline"
            onClick={() => setShowEditProfileModal(true)}
            disabled={isPerformingAction}
            style={{ borderColor: "#8e919b" }}
          >
            <PencilIcon />
            {t("edit_profile")}
          </Button>

          <Button
            theme="danger"
            onClick={handleSignOut}
            disabled={isPerformingAction}
          >
            <SignOutIcon />
            {t("sign_out")}
          </Button>
        </>
      );
    }

    if (userProfile.relation == null) {
      return (
        <>
          <Button
            theme="outline"
            onClick={() => handleFriendAction(userProfile.id, "SEND")}
            disabled={isPerformingAction}
            style={{ borderColor: "#8e919b" }}
          >
            <PersonAddIcon />
            {t("add_friend")}
          </Button>

          <Button
            theme="danger"
            onClick={() => handleFriendAction(userProfile.id, "BLOCK")}
            disabled={isPerformingAction}
          >
            <BlockedIcon />
            {t("block_user")}
          </Button>
        </>
      );
    }

    if (userProfile.relation.status === "ACCEPTED") {
      return (
        <>
          <Button
            theme="danger"
            onClick={() => handleFriendAction(userProfile.id, "BLOCK")}
            disabled={isPerformingAction}
          >
            <BlockedIcon />
            {t("block_user")}
          </Button>
          <Button
            theme="outline"
            onClick={() =>
              handleFriendAction(userProfile.id, "UNDO_FRIENDSHIP")
            }
            disabled={isPerformingAction}
            style={{ borderColor: "#8e919b" }}
          >
            <XCircleFillIcon />
            {t("undo_friendship")}
          </Button>
        </>
      );
    }

    if (userProfile.relation.BId === userProfile.id) {
      return (
        <Button
          theme="outline"
          onClick={() =>
            handleFriendAction(userProfile.relation!.BId, "CANCEL")
          }
          disabled={isPerformingAction}
          style={{ borderColor: "#8e919b" }}
        >
          <XCircleFillIcon /> {t("cancel_request")}
        </Button>
      );
    }

    return (
      <>
        <Button
          theme="outline"
          onClick={() =>
            handleFriendAction(userProfile.relation!.AId, "ACCEPTED")
          }
          disabled={isPerformingAction}
          style={{ borderColor: "#8e919b" }}
        >
          <CheckCircleFillIcon /> {t("accept_request")}
        </Button>
        <Button
          theme="danger"
          onClick={() =>
            handleFriendAction(userProfile.relation!.AId, "REFUSED")
          }
          disabled={isPerformingAction}
        >
          <XCircleFillIcon /> {t("ignore_request")}
        </Button>
      </>
    );
  }, [
    handleFriendAction,
    handleSignOut,
    isMe,
    t,
    isPerformingAction,
    userProfile,
  ]);

  const handleAvatarClick = useCallback(() => {
    if (isMe) {
      setShowEditProfileModal(true);
    }
  }, [isMe]);

  const currentGame = useMemo(() => {
    if (isMe) {
      if (gameRunning)
        return {
          ...gameRunning,
          objectId: gameRunning.objectID,
          sessionDurationInSeconds: gameRunning.sessionDurationInMillis / 1000,
        };

      return null;
    }
    return userProfile?.currentGame;
  }, [isMe, userProfile, gameRunning]);

  return (
    <>
      {/* <ConfirmationModal
        visible
        title={t("sign_out_modal_title")}
        descriptionText={t("sign_out_modal_text")}
        confirmButtonLabel={t("sign_out")}
        cancelButtonLabel={t("cancel")}
      /> */}

      <EditProfileModal
        visible={showEditProfileModal}
        onClose={() => setShowEditProfileModal(false)}
      />

      <section
        className="profile-hero__content-box"
        style={{ background: heroBackground }}
      >
        {backgroundImage && (
          <img
            src={backgroundImage}
            alt=""
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}

        <div
          style={{
            background: backgroundImage ? backgroundImageLayer : "transparent",
            width: "100%",
            height: "100%",
            zIndex: 1,
          }}
        >
          <div className="profile-hero__user-information">
            <button
              type="button"
              className="profile-hero__avatar-button"
              onClick={handleAvatarClick}
            >
              <Avatar
                size={96}
                alt={userProfile?.displayName}
                src={userProfile?.profileImageUrl}
              />
            </button>

            <div className="profile-hero__information">
              {userProfile ? (
                <h2 className="profile-hero__display-name">
                  {userProfile?.displayName}
                </h2>
              ) : (
                <Skeleton width={150} height={28} />
              )}

              {currentGame && (
                <div className="profile-hero__current-game-wrapper">
                  <div className="profile-hero__current-game-details">
                    <Link
                      to={buildGameDetailsPath({
                        ...currentGame,
                        objectId: currentGame.objectId,
                      })}
                    >
                      {currentGame.title}
                    </Link>
                  </div>

                  <small>
                    {t("playing_for", {
                      amount: formatDistance(
                        addSeconds(
                          new Date(),
                          -currentGame.sessionDurationInSeconds
                        ),
                        new Date()
                      ),
                    })}
                  </small>
                </div>
              )}
            </div>

            <UploadBackgroundImageButton />
          </div>
        </div>

        <div
          className="profile-hero__hero-panel"
          style={{
            background: backgroundImage ? backgroundImageLayer : heroBackground,
          }}
        >
          <div className="profile-hero__actions">{profileActions}</div>
        </div>
      </section>
    </>
  );
}
