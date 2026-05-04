import { Avatar, Button, SelectField, TextField } from "@renderer/components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useDate, useToast, useUserDetails } from "@renderer/hooks";
import { useCallback, useContext, useEffect, useState } from "react";
import {
  CloudIcon,
  DeviceCameraIcon,
  EyeIcon,
  KeyIcon,
  MailIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { settingsContext } from "@renderer/context";
import { AuthPage } from "@shared";
import { useNavigate } from "react-router-dom";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import "./settings-account.scss";

interface FormValues {
  displayName: string;
  bio: string;
  profileImageUrl?: string;
  profileVisibility: "PUBLIC" | "FRIENDS" | "PRIVATE";
}

export function SettingsAccount() {
  const { t } = useTranslation("settings");

  const [isUnblocking, setIsUnblocking] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const navigate = useNavigate();
  const { showSuccessToast, showErrorToast } = useToast();

  const { blockedUsers, fetchBlockedUsers } = useContext(settingsContext);

  const { formatDate } = useDate();

  const schema: yup.ObjectSchema<FormValues> = yup.object({
    displayName: yup
      .string()
      .required()
      .min(3, t("displayname_min_length"))
      .max(50, t("displayname_max_length")),
    bio: yup.string().defined().default("").max(200),
    profileImageUrl: yup.string().optional(),
    profileVisibility: yup
      .string()
      .oneOf(["PUBLIC", "FRIENDS", "PRIVATE"] as const)
      .required()
      .default("PUBLIC"),
  });

  const {
    register,
    control,
    watch,
    formState: { errors },
    setValue,
    handleSubmit,
  } = useForm<FormValues>({
    resolver: yupResolver(schema),
  });

  const bioValue = watch("bio", "");

  const {
    userDetails,
    hasActiveSubscription,
    patchUser,
    fetchUserDetails,
    updateUserDetails,
    unblockUser,
  } = useUserDetails();

  useEffect(() => {
    if (userDetails) {
      setValue("profileVisibility", userDetails.profileVisibility);
      setValue("displayName", userDetails.displayName);
      setValue("bio", userDetails.bio ?? "");
    }
  }, [userDetails, setValue]);

  useEffect(() => {
    const unsubscribe = window.electron.onAccountUpdated(() => {
      fetchUserDetails().then((response) => {
        if (response) {
          updateUserDetails(response);
        }
      });
      showSuccessToast(t("account_data_updated_successfully"));
    });

    return () => {
      unsubscribe();
    };
  }, [fetchUserDetails, updateUserDetails, t, showSuccessToast]);

  const visibilityOptions = [
    { value: "PUBLIC", label: t("public") },
    { value: "FRIENDS", label: t("friends_only") },
    { value: "PRIVATE", label: t("private") },
  ];

  const handleVisibilityChange = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value as FormValues["profileVisibility"];
    setValue("profileVisibility", value);
    await patchUser({ profileVisibility: value });
    showSuccessToast(t("changes_saved"));
  };

  const onSaveProfile = async (values: FormValues) => {
    setIsSavingProfile(true);

    try {
      await patchUser({
        displayName: values.displayName,
        bio: values.bio,
        profileImageUrl: values.profileImageUrl,
      });
      await fetchUserDetails();
      showSuccessToast(t("changes_saved"));
    } catch {
      showErrorToast(t("image_process_failure"));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUnblockClick = useCallback(
    (id: string) => {
      setIsUnblocking(true);

      unblockUser(id)
        .then(() => {
          fetchBlockedUsers();
          showSuccessToast(t("user_unblocked"));
        })
        .finally(() => {
          setIsUnblocking(false);
        });
    },
    [unblockUser, fetchBlockedUsers, t, showSuccessToast]
  );

  const getHydraCloudSectionContent = () => {
    const hasSubscribedBefore = Boolean(userDetails?.subscription?.expiresAt);
    const isRenewalActive = userDetails?.subscription?.status === "active";

    if (!hasSubscribedBefore) {
      return {
        description: <small>{t("no_subscription")}</small>,
        callToAction: t("become_subscriber"),
      };
    }

    if (hasActiveSubscription) {
      return {
        description: isRenewalActive ? (
          <>
            <small>
              {t("subscription_renews_on", {
                date: formatDate(userDetails.subscription!.expiresAt!),
              })}
            </small>
            <small>{t("bill_sent_until")}</small>
          </>
        ) : (
          <>
            <small>{t("subscription_renew_cancelled")}</small>
            <small>
              {t("subscription_active_until", {
                date: formatDate(userDetails!.subscription!.expiresAt!),
              })}
            </small>
          </>
        ),
        callToAction: t("manage_subscription"),
      };
    }

    return {
      description: (
        <small>
          {t("subscription_expired_at", {
            date: formatDate(userDetails!.subscription!.expiresAt!),
          })}
        </small>
      ),
      callToAction: t("renew_subscription"),
    };
  };

  if (!userDetails) return null;

  return (
    <div className="settings-account__form">
      {/* ── Profile ── */}
      <h3 className="settings-account__section-title">{t("profile")}</h3>
      <p className="settings-account__section-description">
        {t("profile_description")}
      </p>

      <div className="settings-account__profile-card">
        <div className="settings-account__profile-card-header">
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

                  if (!hasActiveSubscription) {
                    const { imagePath } = await window.electron
                      .processProfileImage(path)
                      .catch(() => {
                        showErrorToast(t("image_process_failure"));
                        return { imagePath: null };
                      });

                    onChange(imagePath);
                  } else {
                    onChange(path);
                  }
                }
              };

              const getImageUrl = () => {
                if (value) return `local:${value}`;
                if (userDetails?.profileImageUrl)
                  return userDetails.profileImageUrl;
                return null;
              };

              return (
                <button
                  type="button"
                  className="settings-account__avatar-button"
                  onClick={handleChangeProfileAvatar}
                >
                  <Avatar
                    size={80}
                    src={getImageUrl()}
                    alt={userDetails?.displayName}
                  />
                  <div className="settings-account__avatar-overlay">
                    <DeviceCameraIcon size={24} />
                  </div>
                </button>
              );
            }}
          />

          <div className="settings-account__profile-fields">
            <TextField
              {...register("displayName")}
              label={t("display_name")}
              minLength={3}
              maxLength={50}
              containerProps={{ style: { width: "100%" } }}
              error={errors.displayName?.message}
            />
            <span className="settings-account__username">
              @{userDetails.username}
            </span>
          </div>
        </div>

        <div className="settings-account__bio-field">
          <label className="settings-account__bio-label">{t("bio")}</label>
          <textarea
            {...register("bio")}
            className="settings-account__bio-textarea"
            placeholder={t("bio_placeholder")}
            maxLength={200}
          />
          <span className="settings-account__bio-char-count">
            {bioValue?.length ?? 0}/200
          </span>
        </div>

        <div className="settings-account__profile-card-actions">
          <Button
            type="button"
            theme="outline"
            onClick={() => navigate(`/profile/${userDetails.id}`)}
          >
            <EyeIcon />
            {t("view_profile")}
          </Button>

          <Button
            type="button"
            disabled={isSavingProfile}
            onClick={handleSubmit(onSaveProfile)}
          >
            {isSavingProfile ? t("saving_profile") : t("save_profile")}
          </Button>
        </div>
      </div>

      {/* ── Privacy & Security row ── */}
      <div className="settings-account__row">
        <div className="settings-account__section-card">
          <h4 className="settings-account__section-card-title">
            {t("privacy")}
          </h4>

          <Controller
            control={control}
            name="profileVisibility"
            render={({ field }) => (
              <div className="settings-account__section-card-content">
                <SelectField
                  label={t("profile_visibility")}
                  value={field.value}
                  onChange={handleVisibilityChange}
                  options={visibilityOptions.map((visibility) => ({
                    key: visibility.value,
                    value: visibility.value,
                    label: visibility.label,
                  }))}
                />
                <small>{t("profile_visibility_description")}</small>
              </div>
            )}
          />
        </div>

        <div className="settings-account__section-card">
          <h4 className="settings-account__section-card-title">
            {t("security")}
          </h4>

          <div className="settings-account__section-card-content">
            <p className="settings-account__email">
              {userDetails?.email ?? t("no_email_account")}
            </p>

            <div className="settings-account__section-card-actions">
              <Button
                theme="outline"
                onClick={() =>
                  window.electron.openAuthWindow(AuthPage.UpdateEmail)
                }
              >
                <MailIcon />
                {t("update_email")}
              </Button>

              <Button
                theme="outline"
                onClick={() =>
                  window.electron.openAuthWindow(AuthPage.UpdatePassword)
                }
              >
                <KeyIcon />
                {t("update_password")}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Hydra Cloud ── */}
      <div className="settings-account__section-card">
        <h4 className="settings-account__section-card-title">
          {t("hydra_cloud")}
        </h4>

        <div className="settings-account__section-card-content">
          <div className="settings-account__subscription-info">
            {getHydraCloudSectionContent().description}
          </div>

          <div className="settings-account__section-card-actions">
            <Button
              theme="outline"
              onClick={() => window.electron.openCheckout()}
            >
              <CloudIcon />
              {getHydraCloudSectionContent().callToAction}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Blocked users ── */}
      <h3 className="settings-account__section-title">{t("blocked_users")}</h3>

      {blockedUsers.length > 0 ? (
        <ul className="settings-account__blocked-users">
          {blockedUsers.map((user) => (
            <li key={user.id} className="settings-account__blocked-user">
              <div className="settings-account__user-info">
                <Avatar
                  className="settings-account__user-avatar"
                  size={32}
                  src={user.profileImageUrl}
                  alt={user.displayName}
                />
                <span>{user.displayName}</span>
              </div>

              <button
                type="button"
                className="settings-account__unblock-button"
                onClick={() => handleUnblockClick(user.id)}
                disabled={isUnblocking}
              >
                <XCircleFillIcon />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <small>{t("no_users_blocked")}</small>
      )}
    </div>
  );
}
