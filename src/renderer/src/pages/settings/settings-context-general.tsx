import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage } from "i18next";
import { orderBy } from "lodash-es";

import { CheckboxField, SelectField } from "@renderer/components";
import type { UserPreferences } from "@types";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import languageResources from "@locales";
import { SettingsAppearance } from "./appearance/settings-appearance";
import { DownloadsPathSetting } from "./downloads-path-setting";
import { StartupBehaviorFields } from "./startup-behavior-fields";

interface LanguageOption {
  option: string;
  nativeName: string;
}

const LANGUAGE_OPTIONS: LanguageOption[] = orderBy(
  Object.entries(languageResources).map(([language, value]) => ({
    nativeName: value.language_name,
    option: language,
  })),
  ["nativeName"],
  "asc"
);

interface SettingsContextGeneralProps {
  appearance: {
    theme: string | null;
    authorId: string | null;
    authorName: string | null;
  };
}

const resolveLanguage = (language: string | undefined) => {
  const languageKeys = Object.keys(languageResources);

  return (
    languageKeys.find((languageKey) => languageKey === language) ??
    languageKeys.find((languageKey) =>
      languageKey.startsWith(language?.split("-")[0] ?? "en")
    ) ??
    "en"
  );
};

const buildForm = (
  preferences: UserPreferences | null,
  defaultDownloadsPath: string
) => ({
  downloadsPath: preferences?.downloadsPath ?? defaultDownloadsPath,
  language: resolveLanguage(preferences?.language),
  preferQuitInsteadOfHiding: preferences?.preferQuitInsteadOfHiding ?? false,
  runAtStartup: preferences?.runAtStartup ?? false,
  startMinimized: preferences?.startMinimized ?? false,
  hideToTrayOnGameStart: preferences?.hideToTrayOnGameStart ?? false,
  launchToLibraryPage: preferences?.launchToLibraryPage ?? false,
  enableAutoInstall: preferences?.enableAutoInstall ?? false,
});

export function SettingsContextGeneral({
  appearance,
}: Readonly<SettingsContextGeneralProps>) {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");

  const [form, setForm] = useState(() => buildForm(userPreferences, ""));

  useEffect(() => {
    window.electron.getDefaultDownloadsPath().then((path) => {
      setDefaultDownloadsPath(path);
    });
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences, defaultDownloadsPath));
  }, [userPreferences, defaultDownloadsPath]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value;
    handleChange({ language: value });
    changeLanguage(value);
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("app_basics")}</h3>

        <DownloadsPathSetting
          downloadsPath={form.downloadsPath}
          defaultDownloadsPath={defaultDownloadsPath}
          onDownloadsPathChange={(downloadsPath) =>
            setForm((prev) => ({ ...prev, downloadsPath }))
          }
        />

        <SelectField
          label={t("language")}
          value={form.language}
          onChange={handleLanguageChange}
          options={LANGUAGE_OPTIONS.map((language) => ({
            key: language.option,
            value: language.option,
            label: language.nativeName,
          }))}
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("startup_behavior")}</h3>

        <StartupBehaviorFields form={form} onChange={handleChange} />

        <CheckboxField
          label={t("launch_hydra_in_library_page")}
          checked={form.launchToLibraryPage}
          onChange={() =>
            handleChange({
              launchToLibraryPage: !form.launchToLibraryPage,
            })
          }
        />
      </div>

      {window.electron.platform === "linux" && (
        <div className="settings-context-panel__group">
          <h3>{t("behavior")}</h3>

          <CheckboxField
            label={t("enable_auto_install")}
            checked={form.enableAutoInstall}
            onChange={() =>
              handleChange({ enableAutoInstall: !form.enableAutoInstall })
            }
          />
        </div>
      )}

      <div className="settings-context-panel__group">
        <h3>{t("appearance")}</h3>
        <SettingsAppearance appearance={appearance} />
      </div>
    </div>
  );
}
