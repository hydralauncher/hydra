import { DeviceCameraIcon, PersonIcon } from "@primer/octicons-react";
import { Button, SelectField, TextField } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { UserProfile } from "@types";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "../user.css";
import { SPACING_UNIT, vars } from "@renderer/theme.css";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

export interface UserEditProfileProps {
  userProfile: UserProfile;
  updateUserProfile: () => Promise<void>;
}

export const UserEditProfile = ({
  userProfile,
  updateUserProfile,
}: UserEditProfileProps) => {
  const { t } = useTranslation("user_profile");

  const [form, setForm] = useState({
    displayName: userProfile.displayName,
    profileVisibility: userProfile.profileVisibility,
    profileImageUrl: null as string | null,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingImage, setIsLoadingImage] = useState(false);

  const { patchUser } = useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  const [profileVisibilityOptions, setProfileVisibilityOptions] = useState<
    { value: string; label: string }[]
  >([]);

  useEffect(() => {
    setProfileVisibilityOptions([
      { value: "PUBLIC", label: t("public") },
      { value: "FRIENDS", label: t("friends_only") },
      { value: "PRIVATE", label: t("private") },
    ]);
  }, [t]);

  const handleChangeProfileAvatar = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        {
          name: "Image",
          extensions: ["jpg", "jpeg", "png", "webp"],
        },
      ],
    });

    if (filePaths && filePaths.length > 0) {
      setIsLoadingImage(true);

      const { imagePath } = await window.electron
        .processProfileImage(filePaths[0])
        .catch(() => {
          return { imagePath: null };
        })
        .finally(() => setIsLoadingImage(false));

      setForm({ ...form, profileImageUrl: imagePath });
    }
  };

  const handleProfileVisibilityChange = (event) => {
    setForm({
      ...form,
      profileVisibility: event.target.value,
    });
  };

  const handleSaveProfile: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    setIsSaving(true);

    patchUser(form)
      .then(async () => {
        await updateUserProfile();
        showSuccessToast(t("saved_successfully"));
      })
      .catch(() => {
        showErrorToast(t("try_again"));
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const profileImageUrl = useMemo(() => {
    if (form.profileImageUrl) return `local:${form.profileImageUrl}`;
    if (userProfile.profileImageUrl) return userProfile.profileImageUrl;
    return null;
  }, [form, userProfile]);

  const profileImageContent = () => {
    if (isLoadingImage) {
      return <Skeleton className={styles.profileAvatar} />;
    }

    if (profileImageUrl) {
      return (
        <img
          className={styles.profileAvatar}
          alt={userProfile.displayName}
          src={profileImageUrl}
        />
      );
    }

    return <PersonIcon size={96} />;
  };

  return (
    <SkeletonTheme baseColor={vars.color.background} highlightColor="#444">
      <form
        onSubmit={handleSaveProfile}
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: `${SPACING_UNIT * 3}px`,
          width: "350px",
        }}
      >
        <button
          type="button"
          className={styles.profileAvatarEditContainer}
          onClick={handleChangeProfileAvatar}
        >
          {profileImageContent()}
          <div className={styles.editProfileImageBadge}>
            <DeviceCameraIcon size={16} />
          </div>
        </button>

        <TextField
          label={t("display_name")}
          value={form.displayName}
          required
          minLength={3}
          maxLength={50}
          containerProps={{ style: { width: "100%" } }}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />

        <SelectField
          label={t("privacy")}
          value={form.profileVisibility}
          onChange={handleProfileVisibilityChange}
          options={profileVisibilityOptions.map((visiblity) => ({
            key: visiblity.value,
            value: visiblity.value,
            label: visiblity.label,
          }))}
        />

        <Button disabled={isSaving} style={{ alignSelf: "end" }} type="submit">
          {isSaving ? t("saving") : t("save")}
        </Button>
      </form>
    </SkeletonTheme>
  );
};
