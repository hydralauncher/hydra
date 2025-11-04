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
  ImageCropper,
  CropArea,
} from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { cropImage } from "@renderer/helpers/image-cropper";
import { logger } from "@renderer/logger";

import { yupResolver } from "@hookform/resolvers/yup";

import * as yup from "yup";

import { userProfileContext } from "@renderer/context";
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

  const { userDetails, fetchUserDetails, hasActiveSubscription } =
    useUserDetails();

  useEffect(() => {
    if (userDetails) {
      setValue("displayName", userDetails.displayName);
    }
  }, [setValue, userDetails]);

  const { patchUser } = useUserDetails();

  const { showSuccessToast, showErrorToast } = useToast();

  const [showCropper, setShowCropper] = useState(false);
  const [selectedImagePath, setSelectedImagePath] = useState<string | null>(
    null
  );
  const [onImageChange, setOnImageChange] = useState<
    ((value: string) => void) | null
  >(null);

  const handleCrop = async (cropArea: CropArea) => {
    if (!selectedImagePath || !onImageChange) return;

    try {
      const imagePathForCrop = selectedImagePath.startsWith("local:")
        ? selectedImagePath.slice(6)
        : selectedImagePath;
      const imageData = await cropImage(
        imagePathForCrop,
        cropArea,
        "image/png"
      );

      const tempFileName = `cropped-profile-${Date.now()}.png`;
      const croppedPath = await window.electron.saveTempFile(
        tempFileName,
        imageData
      );

      if (!hasActiveSubscription) {
        const { imagePath } = await window.electron
          .processProfileImage(croppedPath)
          .catch(() => {
            showErrorToast(t("image_process_failure"));
            return { imagePath: null };
          });

        if (imagePath) {
          onImageChange(imagePath);
        }
      } else {
        onImageChange(croppedPath);
      }

      setShowCropper(false);
      setSelectedImagePath(null);
      setOnImageChange(null);
    } catch (error) {
      logger.error("Failed to crop profile image:", error);
      showErrorToast(t("image_crop_failure"));
      setShowCropper(false);
      setSelectedImagePath(null);
      setOnImageChange(null);
    }
  };

  const handleCancelCrop = () => {
    setShowCropper(false);
    setSelectedImagePath(null);
    setOnImageChange(null);
  };

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
              const handleChangeProfileAvatar = async () => {
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
                  setSelectedImagePath(path);
                  setOnImageChange(() => onChange);
                  setShowCropper(true);
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
                <button
                  type="button"
                  className="edit-profile-modal__avatar-container"
                  onClick={handleChangeProfileAvatar}
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

        {showCropper && selectedImagePath && (
          <Modal
            visible={showCropper}
            title={t("crop_profile_image")}
            onClose={handleCancelCrop}
            large
          >
            <ImageCropper
              imagePath={selectedImagePath}
              onCrop={handleCrop}
              onCancel={handleCancelCrop}
              aspectRatio={1}
            />
          </Modal>
        )}

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
