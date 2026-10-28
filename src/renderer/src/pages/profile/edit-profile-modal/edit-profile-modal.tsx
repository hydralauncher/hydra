import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import cn from "classnames";

import { Avatar, Button, Modal, ModalProps } from "@renderer/components";
import { CoinIcon } from "@renderer/components/gamification";
import { userProfileContext } from "@renderer/context";
import { useAppSelector, useToast, useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import type { UpdateProfileRequest } from "@types";

import { ProfileImageCropModal } from "../profile-image-crop-modal/profile-image-crop-modal";
import { EditProfilePreview } from "./edit-profile-preview";
import { EditProfileTile, EditProfileUploadTile } from "./edit-profile-tile";
import {
  useProfileImagePicker,
  type ProfileImageVariant,
} from "./use-profile-image-picker";
import "./edit-profile-modal.scss";

type EditProfileTab = "photo" | "banner" | "frames";

// "current" keeps what the profile has; "none" removes the banner.
type PhotoDraft = "current" | "new";
type BannerDraft = "current" | "new" | "none";

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
  const isGamificationEnabled = useAppSelector(
    (state) => state.gamification.isEnabled
  );

  const [tab, setTab] = useState<EditProfileTab>("photo");
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft>("current");
  const [bannerDraft, setBannerDraft] = useState<BannerDraft>("current");
  // Uploads stay local files until Save, so Cancel leaves nothing on the CDN.
  const [newPhotoPath, setNewPhotoPath] = useState<string | null>(null);
  const [newBannerPath, setNewBannerPath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!props.visible) return;
    setTab("photo");
    setPhotoDraft("current");
    setBannerDraft("current");
    setNewPhotoPath(null);
    setNewBannerPath(null);
  }, [props.visible]);

  const { pickImage, cropModalProps } = useProfileImagePicker(
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

  if (!userDetails) return null;

  const currentPhotoUrl = userDetails.profileImageUrl;
  const currentBannerUrl = userDetails.backgroundImageUrl;

  const isDirty =
    photoDraft !== "current" ||
    (bannerDraft === "none" ? !!currentBannerUrl : bannerDraft === "new");

  const draftPhotoUrl =
    photoDraft === "new" ? localUrl(newPhotoPath) : currentPhotoUrl;
  const draftBannerUrl = {
    current: currentBannerUrl,
    new: localUrl(newBannerPath),
    none: null,
  }[bannerDraft];

  const handleUploadBanner = () => {
    // Banners are part of Hydra Cloud's profile customization.
    if (!hasActiveSubscription) {
      showHydraCloudModal("customization");
      return;
    }
    void pickImage("banner");
  };

  const handleSave = async () => {
    const values: UpdateProfileRequest = {};
    if (photoDraft === "new" && newPhotoPath) {
      values.profileImageUrl = newPhotoPath;
    }
    if (bannerDraft === "new" && newBannerPath) {
      values.backgroundImageUrl = newBannerPath;
    } else if (bannerDraft === "none" && currentBannerUrl) {
      values.backgroundImageUrl = null;
    }

    setIsSaving(true);
    try {
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
      <p className="edit-profile-modal__hint">{t("photo_tab_hint")}</p>
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
      </div>
    </>
  );

  const renderBannerArt = (url: string | null) => (
    <span
      className={cn("edit-profile-modal__banner-art", {
        "edit-profile-modal__banner-art--empty": !url,
      })}
    >
      {url && <img src={url} alt="" />}
    </span>
  );

  const renderBannerPane = () => (
    <>
      <p className="edit-profile-modal__hint">{t("banner_tab_hint")}</p>
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
            displayName={userDetails.displayName}
            profileImageUrl={draftPhotoUrl}
            backgroundImageUrl={draftBannerUrl}
            showLevel={isGamificationEnabled}
          />
        </div>

        <div className="edit-profile-modal__tabs" role="tablist">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cn("edit-profile-modal__tab", {
                "edit-profile-modal__tab--active": tab === id,
              })}
              onClick={() => setTab(id)}
            >
              {t(`edit_profile_tab_${id}`)}
            </button>
          ))}
        </div>

        <div className="edit-profile-modal__pane" role="tabpanel">
          {panes[tab]()}
        </div>

        <footer className="edit-profile-modal__footer">
          <span className="edit-profile-modal__dirty">
            {isDirty ? t("unsaved_changes") : ""}
          </span>
          <Button theme="outline" onClick={props.onClose} disabled={isSaving}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? t("saving") : t("save_changes")}
          </Button>
        </footer>
      </div>

      <ProfileImageCropModal {...cropModalProps} />
    </Modal>
  );
}
