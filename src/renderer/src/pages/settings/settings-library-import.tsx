import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, CheckboxField } from "@renderer/components";
import { logger } from "@renderer/logger";
import { useAppSelector } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import "./settings-general.scss";

export function SettingsLibraryImport() {
  const { t } = useTranslation("settings");

  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState({
    syncSteamLibraryAutomatically:
      userPreferences?.syncSteamLibraryAutomatically ?? false,
  });

  const handleChange = async (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    await updateUserPreferences(values);
    if (values.syncSteamLibraryAutomatically) {
      await window.electron.watchSteamLibrary();
    } else {
      await window.electron.stopWatchingSteamLibrary();
    }
  };

  const handleImportSteamLibrary = async () => {
    try {
      await window.electron.updateSteamLibrary();
    } catch (err) {
      logger.error(err);
    }
  };

  return (
    <div className="settings-general">
      <ul className="settings-download-sources__list">
        <li className={`settings-download-sources__item`}>
          <h2>{t("steam")}</h2>
          <CheckboxField
            label={t("sync_steam_library_automatically")}
            checked={form.syncSteamLibraryAutomatically}
            onChange={() =>
              handleChange({
                syncSteamLibraryAutomatically:
                  !form.syncSteamLibraryAutomatically,
              })
            }
          />
          <Button theme="outline" onClick={() => handleImportSteamLibrary()}>
            {t("import_library")}
          </Button>
        </li>
      </ul>
    </div>
  );
}
