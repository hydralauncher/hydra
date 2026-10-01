import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { UserPreferences } from "@types";

const buildForm = (preferences: UserPreferences | null) => ({
  streamingEnabled: preferences?.streamingEnabled ?? false,
});

export function SettingsContextConsoleStreaming() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState(() => buildForm(userPreferences));

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  // New console streaming options go here as additional
  // settings-context-panel__group blocks.
  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <CheckboxField
          label={t("enable_console_streaming")}
          checked={form.streamingEnabled}
          onChange={() =>
            handleChange({ streamingEnabled: !form.streamingEnabled })
          }
        />
      </div>
    </div>
  );
}
