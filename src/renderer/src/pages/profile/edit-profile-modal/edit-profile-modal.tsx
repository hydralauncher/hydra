import { useContext, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { Trans, useTranslation } from "react-i18next";

import { DeviceCameraIcon, PersonIcon } from "@primer/octicons-react";
import {
  Button,
  Link,
  Modal,
  ModalProps,
  TextField,
} from "@renderer/components";
import { useAppSelector, useToast, useUserDetails } from "@renderer/hooks";

import { SPACING_UNIT } from "@renderer/theme.css";
import { yupResolver } from "@hookform/resolvers/yup";

import * as yup from "yup";

import * as styles from "./edit-profile-modal.css";
import { userProfileContext } from "@renderer/context";

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

  const { userDetails } = useAppSelector((state) => state.userDetails);
  const { fetchUserDetails } = useUserDetails();

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
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "350px",
        }}
      >
        <div
          style={{
            gap: `${SPACING_UNIT * 3}px`,
            display: "flex",
            flexDirection: "column",
          }}
        >
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

                  const { imagePath } = await window.electron
                    .processProfileImage(path)
                    .catch(() => {
                      showErrorToast(t("image_process_failure"));
                      return { imagePath: null };
                    });

                  onChange(imagePath);
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
                  className={styles.profileAvatarEditContainer}
                  onClick={handleChangeProfileAvatar}
                >
                  {imageUrl ? (
                    <img
                      className={styles.profileAvatar}
                      alt={userDetails?.displayName}
                      src={imageUrl}
                    />
                  ) : (
                    <PersonIcon size={96} />
                  )}

                  <div className={styles.profileAvatarEditOverlay}>
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
            error={errors.displayName}
          />
        </div>

        <small style={{ marginTop: `${SPACING_UNIT * 2}px` }}>
          <Trans i18nKey="privacy_hint" ns="user_profile">
            <Link to="/settings" />
          </Trans>
        </small>

        <Button
          disabled={isSubmitting}
          style={{ alignSelf: "end", marginTop: `${SPACING_UNIT * 3}px` }}
          type="submit"
        >
          {isSubmitting ? t("saving") : t("save")}
        </Button>
      </form>
    </Modal>
  );
}
