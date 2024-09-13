import { SPACING_UNIT } from "@renderer/theme.css";

import * as styles from "./profile-hero.css";
import { useCallback, useContext, useMemo, useState } from "react";
import { userProfileContext } from "@renderer/context";
import {
  CheckCircleFillIcon,
  PencilIcon,
  PersonIcon,
  SignOutIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { buildGameDetailsPath } from "@renderer/helpers";
import { Button, Link } from "@renderer/components";
import { useTranslation } from "react-i18next";
import { useDate, useToast, useUserDetails } from "@renderer/hooks";
import { addSeconds } from "date-fns";
import { useNavigate } from "react-router-dom";

import type { FriendRequestAction } from "@types";
import { UserProfileSettingsModal } from "../user-profile-settings-modal";

type FriendAction =
  | FriendRequestAction
  | ("BLOCK" | "UNDO_FRIENDSHIP" | "SEND");

export function ProfileHero() {
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);

  const context = useContext(userProfileContext);
  const {
    signOut,
    updateFriendRequestState,
    sendFriendRequest,
    undoFriendship,
    blockUser,
  } = useUserDetails();

  const { isMe, heroBackground, getUserProfile } = context;

  const userProfile = context.userProfile!;
  const { currentGame } = userProfile;

  const { t } = useTranslation("user_profile");
  const { formatDistance } = useDate();

  const { showSuccessToast, showErrorToast } = useToast();

  const navigate = useNavigate();

  const handleSignOut = useCallback(async () => {
    await signOut();

    showSuccessToast(t("successfully_signed_out"));
    navigate("/");
  }, [navigate, signOut, showSuccessToast, t]);

  const handleFriendAction = useCallback(
    (userId: string, action: FriendAction) => {
      try {
        if (action === "UNDO_FRIENDSHIP") {
          undoFriendship(userId).then(getUserProfile);
          return;
        }

        if (action === "BLOCK") {
          blockUser(userId).then(() => {
            showSuccessToast(t("user_blocked_successfully"));
            navigate(-1);
          });

          return;
        }

        if (action === "SEND") {
          sendFriendRequest(userProfile.id).then(getUserProfile);
          return;
        }

        updateFriendRequestState(userId, action).then(getUserProfile);
      } catch (err) {
        showErrorToast(t("try_again"));
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
          <Button theme="outline" onClick={() => setShowEditProfileModal(true)}>
            <PencilIcon />
            {t("edit_profile")}
          </Button>

          <Button theme="danger" onClick={handleSignOut}>
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
          >
            {t("add_friend")}
          </Button>

          <Button
            theme="danger"
            onClick={() => handleFriendAction(userProfile.id, "BLOCK")}
          >
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
        >
          <CheckCircleFillIcon /> {t("accept_request")}
        </Button>
        <Button
          theme="outline"
          onClick={() =>
            handleFriendAction(userProfile.relation!.AId, "REFUSED")
          }
        >
          <XCircleFillIcon /> {t("ignore_request")}
        </Button>
      </>
    );
  }, [handleFriendAction, handleSignOut, isMe, t, userProfile]);

  const handleAvatarClick = useCallback(() => {
    if (isMe) {
      setShowEditProfileModal(true);
    }
  }, [isMe]);

  return (
    <>
      {/* <ConfirmationModal
        visible
        title={t("sign_out_modal_title")}
        descriptionText={t("sign_out_modal_text")}
        confirmButtonLabel={t("sign_out")}
        cancelButtonLabel={t("cancel")}
      /> */}

      <UserProfileSettingsModal
        visible={showEditProfileModal}
        userProfile={userProfile}
        updateUserProfile={getUserProfile}
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
          <div></div>
          <div style={{ display: "flex", gap: `${SPACING_UNIT}px` }}>
            {profileActions}
          </div>
        </div>
      </section>
    </>
  );
}
