import { useCallback, useContext, useMemo, useState } from "react";
import { userProfileContext } from "@renderer/context";
import {
  BlockedIcon,
  CheckCircleFillIcon,
  CopyIcon,
  PencilIcon,
  PersonAddIcon,
  SignOutIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { buildGameDetailsPath } from "@renderer/helpers";
import { AVATAR_DECORATIONS } from "@renderer/components/animated-border/avatar-decorations";
import { DecorationPickerModal } from "@renderer/components/decoration-picker-modal/decoration-picker-modal";
import {
  Avatar,
  Button,
  FullscreenMediaModal,
  Link,
} from "@renderer/components";
import { useTranslation } from "react-i18next";
import { useAppSelector, useToast, useUserDetails } from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

import type { FriendRequestAction } from "@types";
import type { ReactNode } from "react";

import Skeleton from "react-loading-skeleton";
import { BadgesBox } from "../profile-content/badges-box";
import { AnimatedBorder } from "@renderer/components/animated-border/animated-border";
import { UploadBackgroundImageButton } from "../upload-background-image-button/upload-background-image-button";
import "./profile-hero.scss";

type FriendAction =
  | FriendRequestAction
  | ("BLOCK" | "UNDO_FRIENDSHIP" | "SEND");

interface ProfileHeroProps {
  children?: ReactNode;
  rightAction?: ReactNode;
}

export function ProfileHero({
  children,
  rightAction,
}: Readonly<ProfileHeroProps>) {
  const [isEditingMode, setIsEditingMode] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [selectedBorder, setSelectedBorder] = useState(
    localStorage.getItem("hydra_avatar_border") || "none"
  );
  const localBorderWidth = localStorage.getItem("hydra_avatar_border_width");
  const [borderWidth, setBorderWidth] = useState(
    localBorderWidth !== null ? Number(localBorderWidth) : 1
  );
  const [showFullscreenAvatar, setShowFullscreenAvatar] = useState(false);
  const [beamSpeed, setBeamSpeed] = useState(
    Number(localStorage.getItem("hydra_avatar_beam_speed")) || 6
  );
  const [beamColor, setBeamColor] = useState(
    localStorage.getItem("hydra_avatar_beam_color") || "#ef4444"
  );
  const [beamLength, setBeamLength] = useState(
    Number(localStorage.getItem("hydra_avatar_beam_length")) || 25
  );
  const [beamChaos, setBeamChaos] = useState(
    Number(localStorage.getItem("hydra_avatar_beam_chaos")) || 0.12
  );
  const [isDecorationModalOpen, setIsDecorationModalOpen] = useState(false);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [isCopyButtonHovered, setIsCopyButtonHovered] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  const { isMe, getUserProfile, userProfile, backgroundImage } =
    useContext(userProfileContext);
  const {
    signOut,
    updateFriendRequestState,
    sendFriendRequest,
    undoFriendship,
    blockUser,
    patchUser,
    fetchUserDetails,
  } = useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const { t } = useTranslation("user_profile");

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

  const handleSaveProfile = useCallback(async () => {
    if (!editDisplayName.trim()) return;
    setIsSavingProfile(true);
    try {
      await patchUser({ displayName: editDisplayName });

      if (userProfile?.id !== "kQ3bLwNy") {
        await getUserProfile();
        await fetchUserDetails();
      } else if (userProfile) {
        userProfile.displayName = editDisplayName;
      }

      setIsEditingMode(false);
      showSuccessToast(
        t("profile_updated", { defaultValue: "Perfil atualizado!" })
      );
    } catch {
      showErrorToast(t("try_again"));
    } finally {
      setIsSavingProfile(false);
    }
  }, [
    editDisplayName,
    patchUser,
    getUserProfile,
    fetchUserDetails,
    showSuccessToast,
    showErrorToast,
    t,
  ]);

  const profileActions = useMemo(() => {
    if (!userProfile) return null;

    if (isMe) {
      if (isEditingMode) {
        return (
          <>
            <button
              type="button"
              className="profile-hero__transparent-action-btn"
              onClick={() => setIsEditingMode(false)}
              disabled={isSavingProfile}
            >
              <XCircleFillIcon />
              {t("cancel", { defaultValue: "Cancelar" })}
            </button>
            <button
              type="button"
              className="profile-hero__transparent-action-btn"
              onClick={handleSaveProfile}
              disabled={isSavingProfile}
            >
              <CheckCircleFillIcon />
              {t("save", { defaultValue: "Salvar" })}
            </button>
          </>
        );
      }

      return (
        <>
          <UploadBackgroundImageButton />

          <button
            type="button"
            className="profile-hero__transparent-action-btn"
            onClick={() => {
              setEditDisplayName(userProfile?.displayName || "");
              setIsEditingMode(true);
            }}
            disabled={isPerformingAction}
          >
            <PencilIcon />
            {t("edit", { defaultValue: "Editar" })}
          </button>

          <button
            type="button"
            className="profile-hero__transparent-action-btn"
            onClick={handleSignOut}
            disabled={isPerformingAction}
          >
            <span
              style={{
                color: "#f87171",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <SignOutIcon fill="#f87171" />
              <span>{t("exit", { defaultValue: "Sair" })}</span>
            </span>
          </button>
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
            className="profile-hero__button--outline"
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
            className="profile-hero__button--outline"
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
          className="profile-hero__button--outline"
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
          className="profile-hero__button--outline"
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
    handleSaveProfile,
    isMe,
    isEditingMode,
    isSavingProfile,
    isPerformingAction,
    t,
    userProfile,
  ]);

  const handleAvatarClick = useCallback(async () => {
    if (isEditingMode) {
      try {
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
          setIsSavingProfile(true);
          await patchUser({ profileImageUrl: filePaths[0] });
          await getUserProfile();
          await fetchUserDetails();
          showSuccessToast(
            t("profile_updated", { defaultValue: "Foto atualizada!" })
          );
        }
      } catch (err) {
        showErrorToast(t("try_again"));
      } finally {
        setIsSavingProfile(false);
      }
      return;
    }
    setShowFullscreenAvatar(true);
  }, [
    isEditingMode,
    patchUser,
    getUserProfile,
    fetchUserDetails,
    showSuccessToast,
    showErrorToast,
    t,
  ]);

  const copyFriendCode = useCallback(() => {
    if (userProfile?.id) {
      navigator.clipboard.writeText(userProfile.id);
      setIsCopied(true);

      const startTime = performance.now();
      const duration = 1200; // 1.2 seconds

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        if (elapsed < duration) {
          requestAnimationFrame(animate);
        } else {
          setIsCopied(false);
        }
      };

      requestAnimationFrame(animate);
    }
  }, [userProfile]);

  const currentGame = useMemo(() => {
    if (isMe) {
      if (gameRunning)
        return {
          ...gameRunning,
          objectId: gameRunning.objectId,
          sessionDurationInSeconds: gameRunning.sessionDurationInMillis / 1000,
        };

      return null;
    }
    return userProfile?.currentGame;
  }, [isMe, userProfile, gameRunning]);

  return (
    <>
      <FullscreenMediaModal
        visible={showFullscreenAvatar}
        onClose={() => setShowFullscreenAvatar(false)}
        src={userProfile?.profileImageUrl}
        alt={userProfile?.displayName}
      />

      <section className="profile-hero__content-box">
        {backgroundImage && (
          <>
            <img
              src={backgroundImage}
              alt=""
              className="profile-hero__background-image"
            />
            <div className="profile-hero__background-image-gradient" />
          </>
        )}

        <div
          className={`profile-hero__background-overlay ${
            !backgroundImage
              ? "profile-hero__background-overlay--transparent"
              : ""
          }`}
        >
          {isEditingMode && (
            <div
              className="profile-hero__edit-overlay-backdrop"
              onClick={() => setIsEditingMode(false)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  setIsEditingMode(false);
                }
              }}
            />
          )}
          <div
            className={`profile-hero__user-information ${isEditingMode ? "profile-hero__user-information--editing" : ""}`}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AnimatedBorder
                borderWidth={borderWidth}
                containerSize={96}
                styleName={selectedBorder as any}
                beamSpeed={beamSpeed}
                beamColor={beamColor}
                beamLength={beamLength}
                beamChaos={beamChaos}
              >
                <button
                  type="button"
                  className={`profile-hero__avatar-button ${isEditingMode ? "profile-hero__avatar-button--editing" : ""}`}
                  onClick={handleAvatarClick}
                  disabled={isSavingProfile}
                >
                  <Avatar
                    size={96}
                    alt={userProfile?.displayName}
                    src={userProfile?.profileImageUrl}
                  />
                  {isEditingMode && (
                    <div className="profile-hero__avatar-edit-overlay">
                      <PencilIcon size={24} />
                    </div>
                  )}
                </button>
              </AnimatedBorder>

              {isEditingMode && (
                <div className="profile-hero__border-picker">
                  {/* Static border style options */}
                  {["none", "border-beam", "electric-border"].map((style) => (
                    <button
                      key={style}
                      type="button"
                      className={`profile-hero__border-picker-btn profile-hero__border-picker-btn--${style} ${
                        selectedBorder === style
                          ? "profile-hero__border-picker-btn--active"
                          : ""
                      }`}
                      onClick={() => {
                        setSelectedBorder(style);
                        localStorage.setItem("hydra_avatar_border", style);
                        window.dispatchEvent(new Event("avatar_style_update"));
                      }}
                      title={style}
                    />
                  ))}

                  {/* Decoration selected preview + open modal button */}
                  <button
                    type="button"
                    className={`profile-hero__decoration-btn ${
                      AVATAR_DECORATIONS.some((d) => d.id === selectedBorder)
                        ? "profile-hero__decoration-btn--active"
                        : ""
                    }`}
                    onClick={() => setIsDecorationModalOpen(true)}
                    title="Alterar decoração"
                  >
                    {AVATAR_DECORATIONS.some((d) => d.id === selectedBorder) ? (
                      <img
                        src={`https://discord-decoration.art/mdecorations/${selectedBorder}.webp`}
                        alt="Decoração atual"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          borderRadius: "inherit",
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          fontSize: "0.6rem",
                          color: "rgba(255,255,255,0.5)",
                          lineHeight: 1.2,
                          textAlign: "center",
                        }}
                      >
                        🎨
                      </span>
                    )}
                  </button>
                </div>
              )}

              {isDecorationModalOpen && (
                <DecorationPickerModal
                  visible={isDecorationModalOpen}
                  currentDecoration={selectedBorder}
                  onSelect={(id) => {
                    setSelectedBorder(id);
                    localStorage.setItem("hydra_avatar_border", id);
                    window.dispatchEvent(new Event("avatar_style_update"));
                  }}
                  onClose={() => setIsDecorationModalOpen(false)}
                />
              )}

              {isEditingMode && selectedBorder !== "none" && (
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    marginTop: 4,
                    alignItems: "center",
                  }}
                >
                  <input
                    type="range"
                    min="1"
                    max="15"
                    value={borderWidth}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBorderWidth(v);
                      localStorage.setItem(
                        "hydra_avatar_border_width",
                        String(v)
                      );
                    }}
                    title="Largura da Borda"
                    style={{ width: 60, cursor: "ew-resize" }}
                  />

                  {(selectedBorder === "border-beam" ||
                    selectedBorder === "electric-border") && (
                    <>
                      <input
                        type="range"
                        min="1"
                        max="20"
                        value={beamSpeed}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setBeamSpeed(v);
                          localStorage.setItem(
                            "hydra_avatar_beam_speed",
                            String(v)
                          );
                          window.dispatchEvent(
                            new Event("avatar_style_update")
                          );
                        }}
                        title="Velocidade da Animação (Menos = Mais rápido)"
                        style={{
                          width: 60,
                          cursor: "ew-resize",
                          direction: "rtl",
                        }}
                      />
                      <input
                        type="color"
                        value={beamColor}
                        onChange={(e) => {
                          setBeamColor(e.target.value);
                          localStorage.setItem(
                            "hydra_avatar_beam_color",
                            e.target.value
                          );
                          window.dispatchEvent(
                            new Event("avatar_style_update")
                          );
                        }}
                        title="Cor do Efeito"
                        style={{
                          width: 24,
                          height: 24,
                          padding: 0,
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                          background: "transparent",
                        }}
                      />
                      {selectedBorder === "border-beam" && (
                        <input
                          type="range"
                          min="5"
                          max="100"
                          value={beamLength}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setBeamLength(v);
                            localStorage.setItem(
                              "hydra_avatar_beam_length",
                              String(v)
                            );
                            window.dispatchEvent(
                              new Event("avatar_style_update")
                            );
                          }}
                          title="Comprimento do Rastro"
                          style={{ width: 60, cursor: "ew-resize" }}
                        />
                      )}
                      {selectedBorder === "electric-border" && (
                        <input
                          type="range"
                          min="1"
                          max="50"
                          value={beamChaos * 100}
                          onChange={(e) => {
                            const v = Number(e.target.value) / 100;
                            setBeamChaos(v);
                            localStorage.setItem(
                              "hydra_avatar_beam_chaos",
                              String(v)
                            );
                            window.dispatchEvent(
                              new Event("avatar_style_update")
                            );
                          }}
                          title="Caos (Espalhamento elétrico)"
                          style={{ width: 60, cursor: "ew-resize" }}
                        />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="profile-hero__information">
              {userProfile ? (
                <>
                  <div className="profile-hero__display-name-container">
                    {isEditingMode ? (
                      <input
                        type="text"
                        className="profile-hero__display-name-input"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        placeholder={t("display_name", {
                          defaultValue: "Nome",
                        })}
                        /* eslint-disable-next-line jsx-a11y/no-autofocus */
                        autoFocus
                      />
                    ) : (
                      <h2 className="profile-hero__display-name">
                        {userProfile?.displayName}
                      </h2>
                    )}

                    <motion.button
                      type="button"
                      className="profile-hero__copy-button"
                      onClick={copyFriendCode}
                      title={t("copy_friend_code")}
                      onMouseEnter={() => setIsCopyButtonHovered(true)}
                      onMouseLeave={() => setIsCopyButtonHovered(false)}
                      initial={{ width: 28 }}
                      animate={{
                        width: isCopyButtonHovered || isCopied ? 105 : 28,
                      }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                    >
                      <motion.span
                        className="profile-hero__friend-code"
                        initial={{ opacity: 0, marginRight: 0 }}
                        animate={{
                          opacity: isCopyButtonHovered || isCopied ? 1 : 0,
                          marginRight: isCopyButtonHovered || isCopied ? 8 : 0,
                        }}
                        transition={{ duration: 0.2, ease: "easeInOut" }}
                      >
                        {isCopied ? t("copied") : userProfile?.id}
                      </motion.span>
                      <CopyIcon size={16} />
                    </motion.button>
                  </div>
                  <BadgesBox />
                </>
              ) : (
                <Skeleton width={150} height={28} />
              )}

              {userProfile?.hasActiveSubscription && (
                <div className="profile-hero__tags">
                  <span className="profile-hero__tag profile-hero__tag--cloud">
                    CLOUD
                  </span>
                  {userProfile?.id === "kQ3bLwNy" && (
                    <>
                      <span className="profile-hero__tag profile-hero__tag--vip">
                        VIP
                      </span>
                      <span className="profile-hero__tag profile-hero__tag--staff">
                        STAFF
                      </span>
                      <span className="profile-hero__tag profile-hero__tag--supporter">
                        SUPPORTER
                      </span>
                    </>
                  )}
                </div>
              )}

              {currentGame && (
                <div className="profile-hero__current-game-wrapper">
                  <small className="profile-hero__playing-text">
                    {t("playing_now", { defaultValue: "Jogando" })}
                  </small>
                  <div className="profile-hero__current-game-details">
                    <Link
                      to={buildGameDetailsPath({
                        ...currentGame,
                        objectId: currentGame.objectId,
                      })}
                      className="profile-hero__game-link"
                    >
                      {currentGame.iconUrl && (
                        <img
                          src={currentGame.iconUrl}
                          alt={currentGame.title}
                          className="profile-hero__game-icon"
                        />
                      )}
                      <span>{currentGame.title}</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div
            className={`profile-hero__bottom-panel ${
              !backgroundImage ? "profile-hero__bottom-panel--transparent" : ""
            }`}
          >
            <div className="profile-hero__tabs-area">{children}</div>
            <div
              className={`profile-hero__actions ${isEditingMode ? "profile-hero__actions--editing" : ""}`}
            >
              {rightAction}
              {profileActions}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
