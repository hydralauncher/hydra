import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { UserPreferences } from "@types";

import { CheckboxField } from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";

export interface SettingsBehaviorProps {
  updateUserPreferences: (values: Partial<UserPreferences>) => void;
}

export function SettingsBehavior({
  updateUserPreferences,
}: SettingsBehaviorProps) {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState({
    preferQuitInsteadOfHiding: false,
    runAtStartup: false,
  });

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        preferQuitInsteadOfHiding: userPreferences.preferQuitInsteadOfHiding,
        runAtStartup: userPreferences.runAtStartup,
      });
    }
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  return (
    <>
      <CheckboxField
        label={t("quit_app_instead_hiding")}
        checked={form.preferQuitInsteadOfHiding}
        onChange={() =>
          handleChange({
            preferQuitInsteadOfHiding: !form.preferQuitInsteadOfHiding,
          })
        }
      />

      <CheckboxField
        label={t("launch_with_system")}
        onChange={() => {
          handleChange({ runAtStartup: !form.runAtStartup });
          window.electron.autoLaunch(!form.runAtStartup);
        }}
        checked={form.runAtStartup}
      />
    </>
  );
}
