import { Avatar, Button, SelectField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-account.css";
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
  }, [fetchUserDetails, updateUserDetails]);

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
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)}>
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
            <section>
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

      <section>
        <h4>{t("current_email")}</h4>
        <p>{userDetails?.email ?? t("no_email_account")}</p>

        <div
          style={{
            display: "flex",
            justifyContent: "start",
            alignItems: "center",
            gap: `${SPACING_UNIT}px`,
            marginTop: `${SPACING_UNIT * 2}px`,
          }}
        >
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

      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: `${SPACING_UNIT * 2}px`,
        }}
      >
        <h3>Hydra Cloud</h3>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: `${SPACING_UNIT}px`,
          }}
        >
          {getHydraCloudSectionContent().description}
        </div>

        <Button
          style={{
            placeSelf: "flex-start",
          }}
          theme="outline"
          onClick={() => window.electron.openCheckout()}
        >
          <CloudIcon />
          {getHydraCloudSectionContent().callToAction}
        </Button>
      </section>

      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: `${SPACING_UNIT * 2}px`,
        }}
      >
        <h3>{t("blocked_users")}</h3>

        {blockedUsers.length > 0 ? (
          <ul className={styles.blockedUsersList}>
            {blockedUsers.map((user) => {
              return (
                <li key={user.id} className={styles.blockedUser}>
                  <div
                    style={{
                      display: "flex",
                      gap: `${SPACING_UNIT}px`,
                      alignItems: "center",
                    }}
                  >
                    <Avatar
                      style={{ filter: "grayscale(100%)" }}
                      size={32}
                      src={user.profileImageUrl}
                      alt={user.displayName}
                    />
                    <span>{user.displayName}</span>
                  </div>

                  <button
                    type="button"
                    className={styles.unblockButton}
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
