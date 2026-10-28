import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import cn from "classnames";
import Skeleton from "react-loading-skeleton";

import {
  Avatar,
  Button,
  Modal,
  ModalProps,
  TextField,
} from "@renderer/components";
import { CoinIcon } from "@renderer/components/gamification";
import { userProfileContext } from "@renderer/context";
import {
  useAppSelector,
  useFormat,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { MAX_MINUTES_TO_SHOW_IN_PLAYTIME } from "@renderer/constants";
import { getArtworkDisplaySource } from "@renderer/hooks/use-game-artwork-grid";
import { useSubscription } from "@renderer/hooks/use-subscription";
import type { UpdateProfileRequest } from "@types";

import { ProfileImageCropModal } from "../profile-image-crop-modal/profile-image-crop-modal";
import { EditProfilePreview } from "./edit-profile-preview";
import { EditProfileTile, EditProfileUploadTile } from "./edit-profile-tile";
import { usePixelAvatar } from "./use-pixel-avatar";
import {
  TOP_GAMES_COUNT,
  useTopGameBanners,
  type TopGameBanner,
} from "./use-top-game-banners";
import {
  useProfileImagePicker,
  type ProfileImageVariant,
} from "./use-profile-image-picker";
import "../profile-content/profile-content.scss";
import "./edit-profile-modal.scss";

type EditProfileTab = "photo" | "banner" | "frames";

// "current" keeps what the profile has; "none" removes the banner;
// "pixel" is the API's procedural avatar.
type PhotoDraft = "current" | "new" | "pixel";
type BannerDraft = "current" | "new" | "none";

// Same limits as the previous modal and the API (updateUserProfileSchema).
const DISPLAY_NAME_MIN = 3;
const DISPLAY_NAME_MAX = 50;

const localUrl = (path: string | null) => (path ? `local:${path}` : null);

export function EditProfileModal(
  props: Omit<ModalProps, "children" | "title">
) {
  const { t } = useTranslation("user_profile");
  const navigate = useNavigate();

  const { userDetails, patchUser, fetchUserDetails, hasActiveSubscription } =
    useUserDetails();
  const { getUserProfile, setSelectedBackgroundImage } =
    useContext(userProfileContext);
  const { showHydraCloudModal } = useSubscription();
  const { showSuccessToast, showErrorToast } = useToast();
  const { numberFormatter } = useFormat();
  const isGamificationEnabled = useAppSelector(
    (state) => state.gamification.isEnabled
  );

  const [tab, setTab] = useState<EditProfileTab>("photo");
  const [displayName, setDisplayName] = useState("");
  // Read on open only, so a user details refresh doesn't wipe the draft.
  const savedNameRef = useRef("");
  savedNameRef.current = userDetails?.displayName ?? "";
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft>("current");
  const [bannerDraft, setBannerDraft] = useState<BannerDraft>("current");
  // Uploads stay local files until Save, so Cancel leaves nothing on the CDN.
  const [newPhotoPath, setNewPhotoPath] = useState<string | null>(null);
  const [newBannerPath, setNewBannerPath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Game banners load the first time the Banner tab opens.
  const [hasOpenedBannerTab, setHasOpenedBannerTab] = useState(false);
  const [downloadingBannerKey, setDownloadingBannerKey] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!props.visible) return;
    setTab("photo");
    setHasOpenedBannerTab(false);
    setDisplayName(savedNameRef.current);
    setPhotoDraft("current");
    setBannerDraft("current");
    setNewPhotoPath(null);
    setNewBannerPath(null);
  }, [props.visible]);

  const { pickImage, cropImage, cropModalProps } = useProfileImagePicker(
    (variant: ProfileImageVariant, croppedPath: string) => {
      if (variant === "avatar") {
        setNewPhotoPath(croppedPath);
        setPhotoDraft("new");
      } else {
        setNewBannerPath(croppedPath);
        setBannerDraft("new");
      }
    }
  );

  const { banners: topGameBanners, isLoading: isLoadingGameBanners } =
    useTopGameBanners(
      props.visible && hasOpenedBannerTab ? (userDetails?.id ?? null) : null
    );

  const { pixelAvatarUrl, savePixelAvatar } = usePixelAvatar(
    props.visible ? (userDetails?.id ?? null) : null
  );

  if (!userDetails) return null;

  const currentPhotoUrl = userDetails.profileImageUrl;
  const currentBannerUrl = userDetails.backgroundImageUrl;

  const trimmedName = displayName.trim();
  const getNameError = () => {
    if (!trimmedName) return t("required_field");
    if (trimmedName.length < DISPLAY_NAME_MIN) {
      return t("displayname_min_length");
    }
    if (trimmedName.length > DISPLAY_NAME_MAX) {
      return t("displayname_max_length");
    }
    return undefined;
  };
  const nameError = getNameError();
  const isNameValid = !nameError;

  const isDirty =
    trimmedName !== userDetails.displayName ||
    photoDraft !== "current" ||
    (bannerDraft === "none" ? !!currentBannerUrl : bannerDraft === "new");

  const draftPhotoUrl = {
    current: currentPhotoUrl,
    new: localUrl(newPhotoPath),
    pixel: pixelAvatarUrl,
  }[photoDraft];
  const draftBannerUrl = {
    current: currentBannerUrl,
    new: localUrl(newBannerPath),
    none: null,
  }[bannerDraft];

  const handleGameBannerClick = async (banner: TopGameBanner) => {
    // Banners are part of Hydra Cloud's profile customization.
    if (!hasActiveSubscription) {
      showHydraCloudModal("customization");
      return;
    }

    setDownloadingBannerKey(banner.key);
    try {
      const path = await window.electron.downloadGameArtwork(banner.hero.url);
      if (!path) throw new Error("Hero download failed");
      // Same crop and upload as a banner picked from the computer.
      await cropImage("banner", path);
    } catch {
      showErrorToast(t("try_again"));
    } finally {
      setDownloadingBannerKey(null);
    }
  };

  const handleUploadBanner = () => {
    // Banners are part of Hydra Cloud's profile customization.
    if (!hasActiveSubscription) {
      showHydraCloudModal("customization");
      return;
    }
    void pickImage("banner");
  };

  const handleSave = async () => {
    if (!isNameValid) return;

    setIsSaving(true);
    try {
      const values: UpdateProfileRequest = {};
      if (trimmedName !== userDetails.displayName) {
        values.displayName = trimmedName;
      }
      if (photoDraft === "new" && newPhotoPath) {
        values.profileImageUrl = newPhotoPath;
      } else if (photoDraft === "pixel") {
        values.profileImageUrl = await savePixelAvatar();
      }
      if (bannerDraft === "new" && newBannerPath) {
        values.backgroundImageUrl = newBannerPath;
      } else if (bannerDraft === "none" && currentBannerUrl) {
        values.backgroundImageUrl = null;
      }

      await patchUser(values);
      if (values.backgroundImageUrl !== undefined) {
        setSelectedBackgroundImage(values.backgroundImageUrl ?? "");
      }
      await Promise.allSettled([fetchUserDetails(), getUserProfile()]);
      props.onClose();
      showSuccessToast(t("profile_updated"), t("profile_updated_hint"));
    } catch {
      showErrorToast(t("try_again"));
    } finally {
      setIsSaving(false);
    }
  };

  const tabs: EditProfileTab[] = isGamificationEnabled
    ? ["photo", "banner", "frames"]
    : ["photo", "banner"];

  const renderPhotoPane = () => (
    <>
      <div className="edit-profile-modal__name">
        <TextField
          label={t("display_name")}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="off"
          spellCheck={false}
          hint={t("display_name_hint")}
          error={nameError}
        />
      </div>

      {/* Same label and hint layout as the TextField above. */}
      <div className="edit-profile-modal__section-header">
        <span>{t("profile_photo")}</span>
        <small>{t("photo_tab_hint")}</small>
      </div>
      <div className="edit-profile-modal__grid">
        <EditProfileUploadTile
          label={t("upload_photo")}
          hint={t("from_your_computer")}
          onClick={() => void pickImage("avatar")}
        />
        {newPhotoPath && (
          <EditProfileTile
            art={<Avatar size={64} src={localUrl(newPhotoPath)} />}
            label={t("new_photo")}
            isSelected={photoDraft === "new"}
            onClick={() => setPhotoDraft("new")}
          />
        )}
        <EditProfileTile
          art={
            <Avatar
              size={64}
              src={currentPhotoUrl}
              alt={userDetails.displayName}
            />
          }
          label={t(currentPhotoUrl ? "current_photo" : "no_photo")}
          isSelected={photoDraft === "current"}
          onClick={() => setPhotoDraft("current")}
        />
        {pixelAvatarUrl && (
          <EditProfileTile
            art={<Avatar size={64} src={pixelAvatarUrl} />}
            label={t("pixel_avatar")}
            isSelected={photoDraft === "pixel"}
            onClick={() => setPhotoDraft("pixel")}
          />
        )}
      </div>
    </>
  );

  const renderBannerArt = (url: string | null) => (
    <span
      className={cn("edit-profile-modal__banner-art", {
        "edit-profile-modal__banner-art--empty": !url,
      })}
    >
      {url && <img src={url} alt="" decoding="async" />}
    </span>
  );

  // Same media choice as the game settings' artwork picker.
  const renderGameBannerArt = (banner: TopGameBanner) => {
    const { src, isVideo } = getArtworkDisplaySource(banner.hero);
    return (
      <span className="edit-profile-modal__banner-art">
        {isVideo ? (
          <video src={src} autoPlay loop muted playsInline />
        ) : (
          <img src={src} alt="" decoding="async" />
        )}
      </span>
    );
  };

  // Same minutes/hours rule as the profile's game lists.
  const getGameBannerPlaytime = (banner: TopGameBanner) => {
    const minutes = banner.playTimeInSeconds / 60;
    return minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME
      ? t("minutes_played", {
          count: Math.round(minutes),
          amount: minutes.toFixed(0),
        })
      : t("hours_played", {
          count: Math.round(minutes / 60),
          amount: numberFormatter.format(minutes / 60),
        });
  };

  const renderBannerPane = () => (
    <>
      <div className="edit-profile-modal__section-header">
        <small>{t("banner_tab_hint")}</small>
      </div>
      <div className="edit-profile-modal__grid edit-profile-modal__grid--wide">
        <EditProfileUploadTile
          label={t("upload_banner")}
          hint={t("from_your_computer")}
          isWide
          onClick={handleUploadBanner}
        />
        <EditProfileTile
          art={renderBannerArt(null)}
          label={t("no_banner")}
          hint={t("no_banner_hint")}
          isWide
          isSelected={
            bannerDraft === "none" ||
            (bannerDraft === "current" && !currentBannerUrl)
          }
          onClick={() => setBannerDraft("none")}
        />
        {newBannerPath && (
          <EditProfileTile
            art={renderBannerArt(localUrl(newBannerPath))}
            label={t("new_banner")}
            isWide
            isSelected={bannerDraft === "new"}
            onClick={() => setBannerDraft("new")}
          />
        )}
        {currentBannerUrl && (
          <EditProfileTile
            art={renderBannerArt(currentBannerUrl)}
            label={t("current_banner")}
            isWide
            isSelected={bannerDraft === "current"}
            onClick={() => setBannerDraft("current")}
          />
        )}
      </div>

      {(isLoadingGameBanners || topGameBanners.length > 0) && (
        <>
          <div className="edit-profile-modal__section-header edit-profile-modal__section-header--spaced">
            <span>{t("from_your_games")}</span>
            <small>{t("from_your_games_hint")}</small>
          </div>
          <div className="edit-profile-modal__grid edit-profile-modal__grid--wide">
            {isLoadingGameBanners &&
              Array.from({ length: TOP_GAMES_COUNT }, (_, index) => (
                <div
                  key={index}
                  className="edit-profile-modal__tile edit-profile-modal__tile--wide edit-profile-modal__tile--skeleton"
                  aria-hidden="true"
                >
                  <span className="edit-profile-modal__tile-art">
                    <Skeleton
                      width="100%"
                      height="100%"
                      borderRadius={0}
                      containerClassName="edit-profile-modal__skeleton-fill"
                    />
                  </span>
                  <span className="edit-profile-modal__tile-label" />
                </div>
              ))}
            {!isLoadingGameBanners &&
              topGameBanners.map((banner) => (
                <EditProfileTile
                  key={banner.key}
                  art={renderGameBannerArt(banner)}
                  label={banner.title}
                  hint={getGameBannerPlaytime(banner)}
                  icon={banner.iconUrl}
                  isWide
                  isDisabled={downloadingBannerKey !== null}
                  onClick={() => void handleGameBannerClick(banner)}
                />
              ))}
          </div>
        </>
      )}
    </>
  );

  // Frames come with the shop API; until then only "no frame" exists.
  const renderFramesPane = () => (
    <div className="edit-profile-modal__grid">
      <EditProfileTile
        art={
          <Avatar size={56} src={draftPhotoUrl} alt={userDetails.displayName} />
        }
        label={t("no_frame")}
        isSelected
        onClick={() => {}}
      />
      <EditProfileTile
        art={<CoinIcon size={24} />}
        label={t("see_in_shop")}
        hint={t("see_in_shop_hint")}
        onClick={() => {
          props.onClose();
          navigate("/shop");
        }}
      />
    </div>
  );

  const panes: Record<EditProfileTab, () => React.ReactNode> = {
    photo: renderPhotoPane,
    banner: renderBannerPane,
    frames: renderFramesPane,
  };

  return (
    <Modal
      {...props}
      title={t("edit_profile")}
      description={t("edit_profile_description")}
      clickOutsideToClose={false}
      noContentPadding
      className="edit-profile-modal"
    >
      <div className="edit-profile-modal__body">
        <div className="edit-profile-modal__preview-wrapper">
          <EditProfilePreview
            displayName={isNameValid ? trimmedName : userDetails.displayName}
            profileImageUrl={draftPhotoUrl}
            backgroundImageUrl={draftBannerUrl}
            showLevel={isGamificationEnabled}
          />
        </div>

        {/* Same tabs as the profile page. */}
        <div className="edit-profile-modal__tabs">
          <div className="profile-content__tabs">
            {tabs.map((id) => (
              <div key={id} className="profile-content__tab-wrapper">
                <button
                  type="button"
                  className={cn("profile-content__tab", {
                    "profile-content__tab--active": tab === id,
                  })}
                  onClick={() => {
                    setTab(id);
                    if (id === "banner") setHasOpenedBannerTab(true);
                  }}
                >
                  {t(`edit_profile_tab_${id}`)}
                </button>
                {tab === id && (
                  <motion.div
                    className="profile-content__tab-underline"
                    layoutId="edit-profile-tab-underline"
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 30,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="edit-profile-modal__pane">{panes[tab]()}</div>

        <footer className="edit-profile-modal__footer">
          <span className="edit-profile-modal__dirty">
            {isDirty ? t("unsaved_changes") : ""}
          </span>
          <Button theme="outline" onClick={props.onClose} disabled={isSaving}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!isDirty || !isNameValid || isSaving}
          >
            {isSaving ? t("saving") : t("save_changes")}
          </Button>
        </footer>
      </div>

      <ProfileImageCropModal {...cropModalProps} />
    </Modal>
  );
}
