import {
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  TextField,
  Button,
  CheckboxField,
  SelectField,
} from "@renderer/components";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "@renderer/hooks";
import { changeLanguage } from "i18next";
import languageResources from "@locales";
import { orderBy } from "lodash-es";
import { settingsContext } from "@renderer/context";
import "./settings-general.scss";
import { DesktopDownloadIcon, UnmuteIcon } from "@primer/octicons-react";
import { logger } from "@renderer/logger";
import { AchievementCustomNotificationPosition } from "@types";

interface LanguageOption {
  option: string;
  nativeName: string;
}

export function SettingsLibraryImport() {
  const { t } = useTranslation("settings");

  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  console.log("userPreferences", userPreferences);

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
      await window.electron.importSteamLibrary();
    } catch (err) {
      logger.error(err);
    }
  };

  return (
    <div className="settings-general">
      <ul className="settings-download-sources__list">
        <li className={`settings-download-sources__item`}>
          <h2>Steam</h2>
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
            Import library
          </Button>
        </li>
      </ul>
    </div>
  );
}
