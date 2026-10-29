import { useContext } from "react";
import { Avatar } from "@renderer/components";
import { userProfileContext } from "@renderer/context";
import { useGamificationProgress } from "@renderer/hooks";
import { GamificationPills } from "../profile-hero/profile-gamification-pills";

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
  const { progress } = useGamificationProgress();
  // Same solid color the profile hero uses when there is no banner.
  const { heroBackground } = useContext(userProfileContext);

  return (
    <div
      className="edit-profile-modal__preview"
      style={{ background: backgroundImageUrl ? undefined : heroBackground }}
    >
      {backgroundImageUrl && (
        <>
          <img
            src={backgroundImageUrl}
            alt=""
            className="edit-profile-modal__preview-banner"
          />
          <i className="edit-profile-modal__preview-shade" />
        </>
      )}

      <div className="edit-profile-modal__preview-who">
        <Avatar size={96} src={profileImageUrl} alt={displayName} />
        <div className="edit-profile-modal__preview-text">
          <strong>{displayName}</strong>
          {showLevel && progress && <GamificationPills level={progress} />}
        </div>
      </div>
    </div>
  );
}
