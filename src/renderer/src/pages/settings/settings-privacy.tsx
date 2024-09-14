import { SelectField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-privacy.css";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useEffect, useState } from "react";
import { XCircleFillIcon } from "@primer/octicons-react";

interface FormValues {
  profileVisibility: "PUBLIC" | "FRIENDS" | "PRIVATE";
}

export function SettingsPrivacy() {
  const { t } = useTranslation("settings");

  const { showSuccessToast } = useToast();

  const {
    control,
    formState: { isSubmitting },
    setValue,
    handleSubmit,
  } = useForm<FormValues>();

  const { patchUser, userDetails } = useUserDetails();

  const [blockedUsers, setBlockedUsers] = useState<any[]>([]);

  useEffect(() => {
    if (userDetails?.profileVisibility) {
      setValue("profileVisibility", userDetails.profileVisibility);
    }
  }, [userDetails, setValue]);

  useEffect(() => {
    window.electron.getBlockedUsers(12, 0).then((users) => {
      setBlockedUsers(users.blocks);
    });
  }, []);

  console.log("BLOCKED USERS", blockedUsers);

  const visibilityOptions = [
    { value: "PUBLIC", label: t("public") },
    { value: "FRIENDS", label: t("friends_only") },
    { value: "PRIVATE", label: t("private") },
  ];

  const onSubmit = async (values: FormValues) => {
    await patchUser(values);
    showSuccessToast(t("changes_saved"));
  };

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

      <ul
        style={{
          padding: 0,
          margin: 0,
          listStyle: "none",
          display: "flex",
        }}
      >
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

              <button type="button" className={styles.unblockButton}>
                <XCircleFillIcon />
              </button>
            </li>
          );
        })}
      </ul>
    </form>
  );
}
