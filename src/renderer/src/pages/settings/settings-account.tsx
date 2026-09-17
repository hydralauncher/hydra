import {
  Avatar,
  Button,
  CheckboxField,
  SelectField,
} from "@renderer/components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useDate, useToast, useUserDetails } from "@renderer/hooks";
import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
import { CloudIcon, KeyIcon, MailIcon } from "@primer/octicons-react";
import { settingsContext } from "@renderer/context";
import { AuthPage } from "@shared";
import "./settings-account.scss";
import type { ProfileVisibility } from "@types";

interface FormValues {
  profileVisibility: ProfileVisibility;
  allowCloudGifts: boolean;
  souvenirsVisibility: ProfileVisibility;
}

interface SettingsAccountGroupProps {
  label: string;
  children: ReactNode;
}

function SettingsAccountGroup({
  label,
  children,
}: Readonly<SettingsAccountGroupProps>) {
  return (
    <section className="settings-account__group">
      <h3 className="settings-account__group-label">{label}</h3>
      <div className="settings-account__card">{children}</div>
    </section>
  );
}

interface SettingsAccountRowProps {
  title: ReactNode;
  titleId?: string;
  hint?: ReactNode;
  children?: ReactNode;
}

function SettingsAccountRow({
  title,
  titleId,
  hint,
  children,
}: Readonly<SettingsAccountRowProps>) {
  return (
    <div className="settings-account__row">
      <div className="settings-account__row-text">
        <span id={titleId} className="settings-account__row-title">
          {title}
        </span>
        {hint ? (
          <span className="settings-account__row-hint">{hint}</span>
        ) : null}
      </div>

      {children ? (
        <div className="settings-account__row-control">{children}</div>
      ) : null}
    </div>
  );
}

export function SettingsAccount() {
  const { t } = useTranslation("settings");

  const [isUnblocking, setIsUnblocking] = useState(false);

  const { showSuccessToast } = useToast();

  const { blockedUsers, fetchBlockedUsers } = useContext(settingsContext);

  const { formatDate } = useDate();

  const profileVisibilityTitleId = useId();
  const souvenirsVisibilityTitleId = useId();

  const {
    control,
    formState: { isSubmitting },
    setValue,
    handleSubmit,
  } = useForm<FormValues>({
    defaultValues: {
      profileVisibility: "PUBLIC",
      souvenirsVisibility: "PRIVATE",
    },
  });

  const {
    userDetails,
    hasActiveSubscription,
    patchUser,
    fetchUserDetails,
    updateUserDetails,
    unblockUser,
  } = useUserDetails();

  useEffect(() => {
    if (userDetails?.profileVisibility) {
      setValue("profileVisibility", userDetails.profileVisibility);
      setValue("allowCloudGifts", userDetails.allowCloudGifts);
    }
    if (userDetails?.souvenirsVisibility) {
      setValue("souvenirsVisibility", userDetails.souvenirsVisibility);
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
    { key: "PUBLIC", value: "PUBLIC", label: t("public") },
    { key: "FRIENDS", value: "FRIENDS", label: t("friends_only") },
    { key: "PRIVATE", value: "PRIVATE", label: t("private") },
  ];

  const onSubmit = async (values: FormValues) => {
    await patchUser(values);
    showSuccessToast(t("changes_saved"));
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
        hint: [t("no_subscription")],
        callToAction: t("become_subscriber"),
      };
    }

    const expiresAt = formatDate(userDetails!.subscription!.expiresAt!);

    if (hasActiveSubscription) {
      return {
        hint: isRenewalActive
          ? [
              t("subscription_renews_on", { date: expiresAt }),
              t("bill_sent_until"),
            ]
          : [
              t("subscription_active_until", { date: expiresAt }),
              t("subscription_renew_cancelled"),
            ],
        callToAction: t("manage_subscription"),
      };
    }

    return {
      hint: [t("subscription_expired_at", { date: expiresAt })],
      callToAction: t("renew_subscription"),
    };
  };

  if (!userDetails) return null;

  const hydraCloud = getHydraCloudSectionContent();

  return (
    <form className="settings-account" onSubmit={handleSubmit(onSubmit)}>
      <SettingsAccountGroup label={t("privacy")}>
        <Controller
          control={control}
          name="profileVisibility"
          render={({ field }) => (
            <SettingsAccountRow
              title={t("profile_visibility")}
              titleId={profileVisibilityTitleId}
              hint={t("profile_visibility_description")}
            >
              <SelectField
                aria-labelledby={profileVisibilityTitleId}
                value={field.value}
                onChange={(event) => {
                  field.onChange(event);
                  void handleSubmit(onSubmit)();
                }}
                options={visibilityOptions}
                disabled={isSubmitting}
              />
            </SettingsAccountRow>
          )}
        />

        <Controller
          control={control}
          name="souvenirsVisibility"
          render={({ field }) => (
            <SettingsAccountRow
              title={t("souvenirs_visibility")}
              titleId={souvenirsVisibilityTitleId}
              hint={t("souvenirs_visibility_description")}
            >
              <SelectField
                aria-labelledby={souvenirsVisibilityTitleId}
                value={field.value}
                onChange={(event) => {
                  field.onChange(event);
                  void handleSubmit(onSubmit)();
                }}
                options={visibilityOptions}
                disabled={isSubmitting}
              />
            </SettingsAccountRow>
          )}
        />
      </SettingsAccountGroup>

      <SettingsAccountGroup label={t("account")}>
        <SettingsAccountRow
          title={t("account_username")}
          hint={userDetails.username}
        >
          <span className="settings-account__row-note">
            {t("username_cannot_be_changed")}
          </span>
        </SettingsAccountRow>

        <SettingsAccountRow
          title={t("account_email")}
          hint={userDetails.email ?? t("no_email_account")}
        >
          <Button
            theme="outline"
            className="settings-account__row-button"
            onClick={() => window.electron.openAuthWindow(AuthPage.UpdateEmail)}
          >
            <MailIcon />
            {t("update_email")}
          </Button>
        </SettingsAccountRow>

        <SettingsAccountRow
          title={t("account_password")}
          hint={t("account_password_description")}
        >
          <Button
            theme="outline"
            className="settings-account__row-button"
            onClick={() =>
              window.electron.openAuthWindow(AuthPage.UpdatePassword)
            }
          >
            <KeyIcon />
            {t("update_password")}
          </Button>
        </SettingsAccountRow>
      </SettingsAccountGroup>

      <SettingsAccountGroup label={t("hydra_cloud")}>
        <SettingsAccountRow
          title={t("subscription")}
          hint={hydraCloud.hint.join(" · ")}
        >
          <Button
            theme="outline"
            className="settings-account__row-button"
            onClick={() => window.electron.openCheckout()}
          >
            <CloudIcon />
            {hydraCloud.callToAction}
          </Button>
        </SettingsAccountRow>

        <Controller
          control={control}
          name="allowCloudGifts"
          render={({ field }) => (
            <SettingsAccountRow
              title={t("allow_cloud_gifts")}
              hint={t("allow_cloud_gifts_description")}
            >
              <CheckboxField
                checked={field.value ?? true}
                disabled={isSubmitting}
                label={
                  <span className="settings-account__visually-hidden">
                    {t("allow_cloud_gifts")}
                  </span>
                }
                onChange={(event) => {
                  field.onChange(event.target.checked);
                  void handleSubmit(onSubmit)();
                }}
              />
            </SettingsAccountRow>
          )}
        />
      </SettingsAccountGroup>

      <SettingsAccountGroup label={t("blocked_users")}>
        {blockedUsers.length > 0 ? (
          <ul className="settings-account__blocked-users">
            {blockedUsers.map((user) => (
              <li key={user.id} className="settings-account__row">
                <div className="settings-account__user-info">
                  <Avatar
                    className="settings-account__user-avatar"
                    size={32}
                    src={user.profileImageUrl}
                    alt={user.displayName}
                  />
                  <span className="settings-account__row-title">
                    {user.displayName}
                  </span>
                </div>

                <div className="settings-account__row-control">
                  <Button
                    theme="outline"
                    className="settings-account__row-button"
                    onClick={() => handleUnblockClick(user.id)}
                    disabled={isUnblocking}
                  >
                    {t("unblock")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="settings-account__row">
            <span className="settings-account__row-hint">
              {t("no_users_blocked")}
            </span>
          </div>
        )}
      </SettingsAccountGroup>
    </form>
  );
}
