import { Combobox } from "@renderer/components";
import type { UserPreferences } from "@types";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export interface SettingsUIProps {
  userPreferences: UserPreferences | null;
  updateUserPreferences: (values: Partial<UserPreferences>) => void;
}

export function SettingsUI({
  userPreferences,
  updateUserPreferences,
}: Readonly<SettingsUIProps>) {
  const { t } = useTranslation("settings");
  const [form, setForm] = useState({
    userRatingStyle: "none",
  });

  useEffect(() => {
    if (userPreferences) {
      setForm({
        userRatingStyle: userPreferences.userRatingStyle,
      });
    }
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  return (
    <div>
      <Combobox
        options={[
          { label: t("none"), value: "none" },
          { label: t("bar"), value: "bar" },
          { label: t("star"), value: "star" },
        ]}
        label={t("ratingStyle")}
        placeholder={t("choose")}
        value={form.userRatingStyle}
        onChange={(e) => {
          const value = e.target.value;
          handleChange({ userRatingStyle: value });
        }}
      />
    </div>
  );
}
