import { useTranslation } from "react-i18next";
import { Avatar } from "@renderer/components";
import { XpBar } from "@renderer/components/gamification";
import { useGamificationProgress } from "@renderer/hooks";

interface EditProfilePreviewProps {
  displayName: string;
  profileImageUrl: string | null;
  backgroundImageUrl: string | null;
  showLevel: boolean;
}

/** The profile as others will see it, with the draft photo and banner. */
export function EditProfilePreview({
  displayName,
  profileImageUrl,
  backgroundImageUrl,
  showLevel,
}: Readonly<EditProfilePreviewProps>) {
  const { t } = useTranslation("user_profile");
  const { progress } = useGamificationProgress();

  return (
    <div className="edit-profile-modal__preview">
      {backgroundImageUrl && (
        <img
          src={backgroundImageUrl}
          alt=""
          className="edit-profile-modal__preview-banner"
        />
      )}
      <i className="edit-profile-modal__preview-shade" />

      <div className="edit-profile-modal__preview-who">
        <Avatar size={96} src={profileImageUrl} alt={displayName} />
        <div className="edit-profile-modal__preview-text">
          <strong>{displayName}</strong>
          {showLevel && progress && (
            <span className="edit-profile-modal__preview-level">
              <strong>{t("level", { level: progress.level })}</strong>
              <XpBar
                xp={progress.xp}
                xpToNextLevel={progress.xpToNextLevel}
                className="edit-profile-modal__preview-level-bar"
              />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
