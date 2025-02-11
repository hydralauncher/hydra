import { Avatar, Button, SelectField } from "@renderer/components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useDate, useToast, useUserDetails } from "@renderer/hooks";
import { useCallback, useContext, useEffect, useState } from "react";
import {
  CloudIcon,
  KeyIcon,
  MailIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { settingsContext } from "@renderer/context";
import { AuthPage } from "@shared";
import "./settings-account.scss";

interface FormValues {
  profileVisibility: "PUBLIC" | "FRIENDS" | "PRIVATE";
}

export function SettingsAccount() {
  const { t } = useTranslation("settings");

  const [isUnblocking, setIsUnblocking] = useState(false);

  const { showSuccessToast } = useToast();

  const { blockedUsers, fetchBlockedUsers } = useContext(settingsContext);

  const { formatDate } = useDate();

  const {
    control,
    formState: { isSubmitting },
    setValue,
    handleSubmit,
  } = useForm<FormValues>();

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
  }, [fetchUserDetails, updateUserDetails, showSuccessToast]);

  const visibilityOptions = [
    { value: "PUBLIC", label: t("public") },
    { value: "FRIENDS", label: t("friends_only") },
    { value: "PRIVATE", label: t("private") },
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
    <form className="settings-account__form" onSubmit={handleSubmit(onSubmit)}>
      <Controller
        control={control}
        name="profileVisibility"
        render={({ field }) => {
          const handleChange = (
            event: React.ChangeEvent<HTMLSelectElement>
          ) => {
            field.onChange(event);
            handleSubmit(onSubmit)();
          };

          return (
            <section className="settings-account__section">
              <SelectField
                label={t("profile_visibility")}
                value={field.value}
                onChange={handleChange}
                options={visibilityOptions.map((visiblity) => ({
                  key: visiblity.value,
                  value: visiblity.value,
                  label: visiblity.label,
                }))}
                disabled={isSubmitting}
              />

              <small>{t("profile_visibility_description")}</small>
            </section>
          );
        }}
      />

      <section className="settings-account__section">
        <h4>{t("current_email")}</h4>
        <p>{userDetails?.email ?? t("no_email_account")}</p>

        <div className="settings-account__actions">
          <Button
            theme="outline"
            onClick={() => window.electron.openAuthWindow(AuthPage.UpdateEmail)}
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
      </section>

      <section className="settings-account__section">
        <h3>Hydra Cloud</h3>
        <div className="settings-account__subscription-info">
          {getHydraCloudSectionContent().description}
        </div>

        <Button
          className="settings-account__subscription-button"
          theme="outline"
          onClick={() => window.electron.openCheckout()}
        >
          <CloudIcon />
          {getHydraCloudSectionContent().callToAction}
        </Button>
      </section>

      <section className="settings-account__section">
        <h3>{t("blocked_users")}</h3>

        {blockedUsers.length > 0 ? (
          <ul className="settings-account__blocked-users">
            {blockedUsers.map((user) => {
              return (
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
              );
            })}
          </ul>
        ) : (
          <small>{t("no_users_blocked")}</small>
        )}
      </section>
    </form>
  );
}
