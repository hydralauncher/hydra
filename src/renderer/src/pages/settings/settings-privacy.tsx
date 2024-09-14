import { SelectField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-privacy.css";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useCallback, useContext, useEffect, useState } from "react";
import { XCircleFillIcon } from "@primer/octicons-react";
import { settingsContext } from "@renderer/context";

interface FormValues {
  profileVisibility: "PUBLIC" | "FRIENDS" | "PRIVATE";
}

export function SettingsPrivacy() {
  const { t } = useTranslation("settings");

  const [isUnblocking, setIsUnblocking] = useState(false);

  const { showSuccessToast } = useToast();

  const { blockedUsers, fetchBlockedUsers } = useContext(settingsContext);

  const {
    control,
    formState: { isSubmitting },
    setValue,
    handleSubmit,
  } = useForm<FormValues>();

  const { patchUser, userDetails } = useUserDetails();

  const { unblockUser } = useUserDetails();

  useEffect(() => {
    if (userDetails?.profileVisibility) {
      setValue("profileVisibility", userDetails.profileVisibility);
    }
  }, [userDetails, setValue]);

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
          // show toast
        })
        .catch((err) => {
          //show toast
        })
        .finally(() => {
          setIsUnblocking(false);
        });
    },
    [unblockUser, fetchBlockedUsers]
  );

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
            <>
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
            </>
          );
        }}
      />

      <h3 style={{ marginTop: `${SPACING_UNIT * 2}px` }}>
        Usuários bloqueados
      </h3>

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
                <img
                  src={user.profileImageUrl}
                  alt={user.displayName}
                  className={styles.blockedUserAvatar}
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
    </form>
  );
}
