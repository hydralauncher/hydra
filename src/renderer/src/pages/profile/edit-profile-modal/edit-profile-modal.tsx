import { useContext, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Trans, useTranslation } from "react-i18next";

import { DeviceCameraIcon } from "@primer/octicons-react";
import {
  Avatar,
  Button,
  Link,
  Modal,
  ModalProps,
  TextField,
} from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";

import { yupResolver } from "@hookform/resolvers/yup";

import * as yup from "yup";

import { userProfileContext } from "@renderer/context";
import { getProfileImageMetadata } from "../profile-image-metadata";
import { ProfileImageCropModal } from "../profile-image-crop-modal/profile-image-crop-modal";
import "./edit-profile-modal.scss";

interface FormValues {
  profileImageUrl?: string;
  displayName: string;
}

export function EditProfileModal(
  props: Omit<ModalProps, "children" | "title">
) {
  const { t } = useTranslation("user_profile");

  const schema = yup.object({
    displayName: yup
      .string()
      .required(t("required_field"))
      .min(3, t("displayname_min_length"))
      .max(50, t("displayname_max_length")),
  });

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
  });

  const { getUserProfile } = useContext(userProfileContext);
  const [profileImageToCrop, setProfileImageToCrop] = useState<string | null>(
    null
  );
  const [cropIsAnimated, setCropIsAnimated] = useState(false);

  const { userDetails, fetchUserDetails, hasActiveSubscription } =
    useUserDetails();

  useEffect(() => {
    if (userDetails) {
      setValue("displayName", userDetails.displayName);
    }
  }, [setValue, userDetails]);

  const { patchUser } = useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  const onSubmit = async (values: FormValues) => {
    return patchUser(values)
      .then(async () => {
        await Promise.allSettled([fetchUserDetails(), getUserProfile()]);
        props.onClose();
        showSuccessToast(t("saved_successfully"));
      })
      .catch(() => {
        showErrorToast(t("try_again"));
      });
  };

  return (
    <Modal {...props} title={t("edit_profile")} clickOutsideToClose={false}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="edit-profile-modal__form"
      >
        <div className="edit-profile-modal__content">
          <Controller
            control={control}
            name="profileImageUrl"
            render={({ field: { value, onChange } }) => {
              const handleProfileImagePath = async (path: string) => {
                const metadata = await getProfileImageMetadata(path);

                if (metadata.isAnimated && hasActiveSubscription) {
                  // Crop while preserving animation (handled in main/sharp).
                  setCropIsAnimated(true);
                  setProfileImageToCrop(path);
                  return;
                }

                if (metadata.isAnimated && !hasActiveSubscription) {
                  const { imagePath } = await window.electron
                    .processProfileImage(path)
                    .catch(() => {
                      showErrorToast(t("image_process_failure"));
                      return { imagePath: null };
                    });

                  if (imagePath) {
                    setCropIsAnimated(false);
                    setProfileImageToCrop(imagePath);
                  }

                  return;
                }

                setCropIsAnimated(false);
                setProfileImageToCrop(path);
              };

              const handleChangeProfileAvatar = async () => {
                const { filePaths } = await window.electron.showOpenDialog({
                  properties: ["openFile"],
                  filters: [
                    {
                      name: "Image",
                      extensions: ["jpg", "jpeg", "png", "apng", "gif", "webp"],
                    },
                  ],
                });

                if (filePaths && filePaths.length > 0) {
                  handleProfileImagePath(filePaths[0]);
                }
              };

              const getImageUrl = () => {
                if (value) return `local:${value}`;
                if (userDetails?.profileImageUrl)
                  return userDetails.profileImageUrl;

                return null;
              };

              const imageUrl = getImageUrl();

              return (
                <>
                  <button
                    type="button"
                    className="edit-profile-modal__avatar-container"
                    onClick={handleChangeProfileAvatar}
                    aria-label={t("change_profile_picture")}
                  >
                    <Avatar
                      size={128}
                      src={imageUrl}
                      alt={userDetails?.displayName}
                    />

                    <div className="edit-profile-modal__avatar-overlay">
                      <DeviceCameraIcon size={38} />
                    </div>
                  </button>

                  <ProfileImageCropModal
                    visible={!!profileImageToCrop}
                    imagePath={profileImageToCrop}
                    variant="avatar"
                    isAnimated={cropIsAnimated}
                    onClose={() => setProfileImageToCrop(null)}
                    onApply={(croppedImagePath) => {
                      onChange(croppedImagePath);
                      setProfileImageToCrop(null);
                    }}
                  />
                </>
              );
            }}
          />

          <TextField
            {...register("displayName")}
            label={t("display_name")}
            minLength={3}
            maxLength={50}
            containerProps={{ style: { width: "100%" } }}
            error={errors.displayName?.message}
          />
        </div>

        <small className="edit-profile-modal__hint">
          <Trans i18nKey="privacy_hint" ns="user_profile">
            <Link to="/settings" />
          </Trans>
        </small>

        <Button
          disabled={isSubmitting}
          className="edit-profile-modal__submit"
          type="submit"
        >
          {isSubmitting ? t("saving") : t("save")}
        </Button>
      </form>
    </Modal>
  );
}
