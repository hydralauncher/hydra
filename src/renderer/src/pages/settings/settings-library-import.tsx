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

  const [canInstallCommonRedist, setCanInstallCommonRedist] = useState(false);
  const [installingCommonRedist, setInstallingCommonRedist] = useState(false);

  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    friendRequestNotificationsEnabled: false,
    friendStartGameNotificationsEnabled: true,
    achievementNotificationsEnabled: true,
    achievementCustomNotificationsEnabled: true,
    achievementCustomNotificationPosition:
      "top-left" as AchievementCustomNotificationPosition,
    achievementSoundVolume: 15,
    language: "",
    customStyles: window.localStorage.getItem("customStyles") || "",
  });

  const [steamLibraryImportProgress, setSteamLibraryImportProgress] =
    useState<number>(0);

  useEffect(() => {
    const unlisten = window.electron.onSteamLibraryImportProgress(
      (progress) => {
        setSteamLibraryImportProgress(progress);
      }
    );

    return () => unlisten();
  }, []);

  const handleImportSteamLibrary = async () => {
    setSteamLibraryImportProgress(0);
    try {
      await window.electron.importSteamLibrary();
    } catch (err) {
      logger.error(err);
      setSteamLibraryImportProgress(0);
    }
  };

  return (
    <div className="settings-general">
      <ul className="settings-download-sources__list">
        <li className={`settings-download-sources__item`}>
          <h2>Steam</h2>
          <Button theme="outline" onClick={() => handleImportSteamLibrary()}>
            Import library
          </Button>
        </li>
      </ul>
    </div>
  );
}
