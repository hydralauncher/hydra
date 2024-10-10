import { SPACING_UNIT, vars } from "@renderer/theme.css";

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
  UploadIcon,
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
import Skeleton from "react-loading-skeleton";

type FriendAction =
  | FriendRequestAction
  | ("BLOCK" | "UNDO_FRIENDSHIP" | "SEND");

export function ProfileHero() {
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [isPerformingAction, setIsPerformingAction] = useState(false);

  const { isMe, getUserProfile, userProfile } = useContext(userProfileContext);
  const {
    signOut,
    updateFriendRequestState,
    sendFriendRequest,
    undoFriendship,
    blockUser,
  } = useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const [hero, setHero] = useState("");

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
            style={{ borderColor: vars.color.body }}
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
            style={{ borderColor: vars.color.body }}
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
          style={{ borderColor: vars.color.body }}
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
          style={{ borderColor: vars.color.body }}
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
          sessionDurationInSeconds: gameRunning.sessionDurationInMillis / 1000,
        };

      return null;
    }
    return userProfile?.currentGame;
  }, [isMe, userProfile, gameRunning]);

  const handleChangeCoverClick = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Image",
          extensions: ["jpg", "jpeg", "png", "gif", "webp"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];

      setHero(path);

      // onChange(imagePath);
    }
  };

  const getImageUrl = () => {
    if (hero) return `local:${hero}`;
    // if (userDetails?.profileImageUrl) return userDetails.profileImageUrl;

    return "";
  };

  // const imageUrl = getImageUrl();

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

      <section className={styles.profileContentBox}>
        <img
          src={getImageUrl()}
          alt=""
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        <div
          style={{
            background:
              "linear-gradient(135deg, rgb(0 0 0 / 70%), rgb(0 0 0 / 60%))",
            width: "100%",
            height: "100%",
            zIndex: 1,
          }}
        >
          <div className={styles.userInformation}>
            <button
              type="button"
              className={styles.profileAvatarButton}
              onClick={handleAvatarClick}
            >
              <div className={styles.xdTotal} />
              {userProfile?.profileImageUrl ? (
                <img
                  className={styles.profileAvatar}
                  alt={userProfile?.displayName}
                  src={userProfile?.profileImageUrl}
                />
              ) : (
                <PersonIcon size={72} />
              )}
            </button>

            <div className={styles.profileInformation}>
              {userProfile ? (
                <h2 className={styles.profileDisplayName}>
                  {userProfile?.displayName}
                </h2>
              ) : (
                <Skeleton width={150} height={28} />
              )}

              {currentGame && (
                <div className={styles.currentGameWrapper}>
                  <div className={styles.currentGameDetails}>
                    <Link
                      to={buildGameDetailsPath({
                        ...currentGame,
                        objectId: currentGame.objectID,
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

            <Button
              theme="outline"
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                borderColor: vars.color.body,
              }}
              onClick={handleChangeCoverClick}
            >
              <UploadIcon />
              Upload cover
            </Button>
          </div>
        </div>

        <div
          className={styles.heroPanel}
          // style={{ background: heroBackground }}
          style={{
            background:
              "linear-gradient(135deg, rgb(0 0 0 / 70%), rgb(0 0 0 / 60%))",
          }}
        >
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
