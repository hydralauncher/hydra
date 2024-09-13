import { Button, SelectField } from "@renderer/components";
import { SPACING_UNIT } from "@renderer/theme.css";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-privacy.css";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useEffect } from "react";

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

  return (
    <form className={styles.form} onSubmit={handleSubmit(onSubmit)}>
      <Controller
        control={control}
        name="profileVisibility"
        render={({ field }) => (
          <>
            <SelectField
              label={t("profile_visibility")}
              value={field.value}
              onChange={field.onChange}
              options={visibilityOptions.map((visiblity) => ({
                key: visiblity.value,
                value: visiblity.value,
                label: visiblity.label,
              }))}
            />

            <small>{t("profile_visibility_description")}</small>
          </>
        )}
      />

      <Button
        type="submit"
        style={{ alignSelf: "flex-end", marginTop: `${SPACING_UNIT * 2}px` }}
        disabled={isSubmitting}
      >
        {t("save_changes")}
      </Button>
    </form>
  );
}
