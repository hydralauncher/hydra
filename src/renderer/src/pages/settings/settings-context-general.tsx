import { useContext, useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { changeLanguage } from "i18next";
import { orderBy } from "lodash-es";

import {
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import languageResources from "@locales";
import { UnmuteIcon } from "@primer/octicons-react";
import "./settings-general.scss";

interface LanguageOption {
  option: string;
  nativeName: string;
}

export function SettingsContextGeneral() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);
  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");
  const [showRunAtStartup, setShowRunAtStartup] = useState(false);

  const volumeUpdateTimeoutRef = useRef<NodeJS.Timeout>();

  const [form, setForm] = useState({
    downloadsPath: "",
    language: "",
    preferQuitInsteadOfHiding: false,
    runAtStartup: false,
    startMinimized: false,
    hideToTrayOnGameStart: false,
    enableAutoInstall: false,
    backgroundMusicEnabled: false,
    backgroundMusicVolume: 15,
    alwaysAskDownloadLocation: false,
  });

  useEffect(() => {
    window.electron.getDefaultDownloadsPath().then((path) => {
      setDefaultDownloadsPath(path);
    });

    window.electron.isPortableVersion().then((isPortableVersion) => {
      setShowRunAtStartup(!isPortableVersion);
    });

    setLanguageOptions(
      orderBy(
        Object.entries(languageResources).map(([language, value]) => ({
          nativeName: value.language_name,
          option: language,
        })),
        ["nativeName"],
        "asc"
      )
    );
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    const languageKeys = Object.keys(languageResources);
    const language =
      languageKeys.find((language) => language === userPreferences.language) ??
      languageKeys.find((language) => {
        return language.startsWith(
          userPreferences.language?.split("-")[0] ?? "en"
        );
      });

    setForm({
      downloadsPath: userPreferences.downloadsPath ?? defaultDownloadsPath,
      language: language ?? "en",
      preferQuitInsteadOfHiding:
        userPreferences.preferQuitInsteadOfHiding ?? false,
      runAtStartup: userPreferences.runAtStartup ?? false,
      startMinimized: userPreferences.startMinimized ?? false,
      hideToTrayOnGameStart: userPreferences.hideToTrayOnGameStart ?? false,
      enableAutoInstall: userPreferences.enableAutoInstall ?? false,
      backgroundMusicEnabled: userPreferences.backgroundMusicEnabled ?? false,
      backgroundMusicVolume: Math.round(
        (userPreferences.backgroundMusicVolume ?? 0.15) * 100
      ),
      alwaysAskDownloadLocation:
        userPreferences.alwaysAskDownloadLocation ?? false,
    });
  }, [userPreferences, defaultDownloadsPath]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (volumeUpdateTimeoutRef.current) {
        clearTimeout(volumeUpdateTimeoutRef.current);
      }
    };
  }, []);

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

  const handleMusicVolumeChange = useCallback(
    (newVolume: number) => {
      setForm((prev) => ({ ...prev, backgroundMusicVolume: newVolume }));

      if (volumeUpdateTimeoutRef.current) {
        clearTimeout(volumeUpdateTimeoutRef.current);
      }

      volumeUpdateTimeoutRef.current = setTimeout(() => {
        updateUserPreferences({ backgroundMusicVolume: newVolume / 100 });
      }, 300);
    },
    [updateUserPreferences]
  );

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: form.downloadsPath,
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      handleChange({ downloadsPath: filePaths[0] });
    }
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("app_basics")}</h3>

        <div className="settings-context-panel__row">
          <SelectField
            label={t("language")}
            value={form.language}
            onChange={handleLanguageChange}
            options={languageOptions.map((language) => ({
              key: language.option,
              value: language.option,
              label: language.nativeName,
            }))}
          />

          <div className="settings-context-panel__row__col">
            <TextField
              label={t("downloads_path")}
              value={form.downloadsPath}
              readOnly
              disabled
              rightContent={
                <Button theme="outline" onClick={handleChooseDownloadsPath}>
                  {t("change")}
                </Button>
              }
            />

            <CheckboxField
              label={t("always_ask_download_location")}
              checked={form.alwaysAskDownloadLocation}
              onChange={() =>
                handleChange({
                  alwaysAskDownloadLocation: !form.alwaysAskDownloadLocation,
                })
              }
            />
          </div>
        </div>
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("startup_behavior")}</h3>

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
          label={t("hide_to_tray_on_game_start")}
          checked={form.hideToTrayOnGameStart}
          onChange={() =>
            handleChange({
              hideToTrayOnGameStart: !form.hideToTrayOnGameStart,
            })
          }
        />

        {showRunAtStartup && (
          <CheckboxField
            label={t("launch_with_system")}
            onChange={() => {
              handleChange({ runAtStartup: !form.runAtStartup });
              window.electron.autoLaunch({
                enabled: !form.runAtStartup,
                minimized: form.startMinimized,
              });
            }}
            checked={form.runAtStartup}
          />
        )}

        {showRunAtStartup && (
          <CheckboxField
            label={t("launch_minimized")}
            style={{ cursor: form.runAtStartup ? "pointer" : "not-allowed" }}
            checked={form.runAtStartup && form.startMinimized}
            disabled={!form.runAtStartup}
            onChange={() => {
              handleChange({ startMinimized: !form.startMinimized });
              window.electron.autoLaunch({
                minimized: !form.startMinimized,
                enabled: form.runAtStartup,
              });
            }}
          />
        )}
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
        <h3>{t("audio", { defaultValue: "Áudio" })}</h3>

        <CheckboxField
          label={t("background_music_enabled", {
            defaultValue: "Habilitar Musica de Fundo",
          })}
          checked={form.backgroundMusicEnabled}
          onChange={() =>
            handleChange({
              backgroundMusicEnabled: !form.backgroundMusicEnabled,
            })
          }
        />

        {form.backgroundMusicEnabled && (
          <div className="settings-general__volume-control">
            <label htmlFor="music-volume">
              {t("background_music_volume", {
                defaultValue: "Volume da M\u00fasica",
              })}
            </label>
            <div className="settings-general__volume-slider-wrapper">
              <UnmuteIcon size={16} className="settings-general__volume-icon" />
              <input
                id="music-volume"
                type="range"
                min="0"
                max="100"
                value={form.backgroundMusicVolume}
                onChange={(e) => {
                  const volumePercent = parseInt(e.target.value, 10);
                  if (!isNaN(volumePercent)) {
                    handleMusicVolumeChange(volumePercent);
                  }
                }}
                className="settings-general__volume-slider"
                style={
                  {
                    "--volume-percent": `${form.backgroundMusicVolume}%`,
                  } as React.CSSProperties
                }
              />
              <span className="settings-general__volume-value">
                {form.backgroundMusicVolume}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
