import { SPACING_UNIT } from "@renderer/theme.css";

import * as styles from "./profile-hero.css";
import { useCallback, useContext, useMemo, useState } from "react";
import { userProfileContext } from "@renderer/context";
import {
  BlockedIcon,
  CheckCircleFillIcon,
  PencilIcon,
  PersonAddIcon,
  PersonIcon,
  SignOutIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { buildGameDetailsPath } from "@renderer/helpers";
import { Button, Link } from "@renderer/components";
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

type FriendAction =
  | FriendRequestAction
  | ("BLOCK" | "UNDO_FRIENDSHIP" | "SEND");

export function ProfileHero() {
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [isPerformingAction, setIsPerformingAction] = useState(false);

  const context = useContext(userProfileContext);
  const {
    signOut,
    updateFriendRequestState,
    sendFriendRequest,
    undoFriendship,
    blockUser,
  } = useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const { isMe, heroBackground, getUserProfile } = context;

  const userProfile = context.userProfile!;

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
      userProfile.id,
    ]
  );

  const profileActions = useMemo(() => {
    if (isMe) {
      return (
        <>
          <Button
            theme="outline"
            onClick={() => setShowEditProfileModal(true)}
            disabled={isPerformingAction}
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
        <Button
          theme="outline"
          onClick={() => handleFriendAction(userProfile.id, "UNDO_FRIENDSHIP")}
          disabled={isPerformingAction}
        >
          <XCircleFillIcon />
          {t("undo_friendship")}
        </Button>
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
        >
          <CheckCircleFillIcon /> {t("accept_request")}
        </Button>
        <Button
          theme="outline"
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
    return userProfile.currentGame;
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
        className={styles.profileContentBox}
        style={{ background: heroBackground }}
      >
        <div className={styles.userInformation}>
          <button
            type="button"
            className={styles.profileAvatarButton}
            onClick={handleAvatarClick}
          >
            {userProfile.profileImageUrl ? (
              <img
                className={styles.profileAvatar}
                alt={userProfile.displayName}
                src={userProfile.profileImageUrl}
              />
            ) : (
              <PersonIcon size={72} />
            )}
          </button>

          <div className={styles.profileInformation}>
            <h2 className={styles.profileDisplayName}>
              {userProfile.displayName}
            </h2>

            {currentGame && (
              <div className={styles.currentGameWrapper}>
                <div className={styles.currentGameDetails}>
                  <Link
                    to={buildGameDetailsPath({
                      ...currentGame,
                      objectID: currentGame.objectId,
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
        </div>

        <div className={styles.heroPanel}>
          <div
            style={{
              display: "flex",
              gap: `${SPACING_UNIT}px`,
              justifyContent: "flex-end",
              flex: 1,
            }}
          >
            {profileActions}
          </div>
        </div>
      </section>
    </>
  );
}
