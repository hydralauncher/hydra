import { useCallback, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDirectoryIcon, HistoryIcon } from "@primer/octicons-react";

import {
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import { useScreenshotInputStatus } from "@renderer/hooks/use-screenshot-input-status";
import { logger } from "@renderer/logger";
import {
  SCREENSHOT_VISIBILITY_OPTIONS,
  resolveScreenshotPreferences,
} from "@shared";
import type {
  ProfileVisibility,
  ScreenshotGamepadButton,
  ScreenshotHotkeyBinding,
  ScreenshotInputStatus,
  UserPreferences,
} from "@types";

import { SettingsScreenshotsHotkey } from "./settings-screenshots-hotkey";
import { SettingsScreenshotsGamepad } from "./settings-screenshots-gamepad";

import "./settings-context-screenshots.scss";

const isScreenshotVisibility = (value: string): value is ProfileVisibility =>
  SCREENSHOT_VISIBILITY_OPTIONS.includes(value as ProfileVisibility);

function ScreenshotInputStatusLine({
  status,
}: Readonly<{ status: ScreenshotInputStatus | null }>) {
  const { t } = useTranslation("settings");
  const { t: tInput } = useTranslation("screenshots_input");

  if (!status) return null;

  const hint = status.hint ? tInput(status.hint) : null;

  if (status.keyboardBackend === "unavailable") {
    return (
      <small className="settings-screenshots__input-status settings-screenshots__input-status--unavailable">
        {t("screenshots_input_unavailable")}
        {hint && (
          <span className="settings-screenshots__input-hint">{hint}</span>
        )}
      </small>
    );
  }

  if (status.active) {
    return (
      <small className="settings-screenshots__input-status settings-screenshots__input-status--active">
        {t("screenshots_input_active")}
        {hint && (
          <span className="settings-screenshots__input-hint">{hint}</span>
        )}
      </small>
    );
  }

  return (
    <small className="settings-screenshots__input-status">
      {t("screenshots_input_idle")}
      {hint && <span className="settings-screenshots__input-hint">{hint}</span>}
    </small>
  );
}

export function SettingsContextScreenshots() {
  const { t } = useTranslation("settings");
  const { t: tCapture } = useTranslation("screenshots_capture");
  const { updateUserPreferences } = useContext(settingsContext);
  const inputStatus = useScreenshotInputStatus();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState(() =>
    resolveScreenshotPreferences(userPreferences)
  );
  const [screenshotsPath, setScreenshotsPath] = useState("");

  useEffect(() => {
    if (!userPreferences) return;

    setForm(resolveScreenshotPreferences(userPreferences));
  }, [userPreferences]);

  useEffect(() => {
    window.electron
      .getScreenshotsFolderPath()
      .then(setScreenshotsPath)
      .catch((error) =>
        logger.error("Failed to read the screenshots folder", error)
      );
  }, []);

  const savePreferences = useCallback(
    (
      formValues: Partial<typeof form>,
      preferenceValues: Partial<UserPreferences>
    ) => {
      setForm((previous) => ({ ...previous, ...formValues }));
      void updateUserPreferences(preferenceValues);
    },
    [updateUserPreferences]
  );

  const handleHotkeyChange = useCallback(
    (hotkey: ScreenshotHotkeyBinding) =>
      savePreferences({ hotkey }, { screenshotHotkey: hotkey }),
    [savePreferences]
  );

  const handleGamepadComboChange = useCallback(
    (gamepadCombo: ScreenshotGamepadButton[]) =>
      savePreferences(
        { gamepadCombo },
        { screenshotGamepadCombo: gamepadCombo }
      ),
    [savePreferences]
  );

  const handleChooseScreenshotsPath = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      defaultPath: screenshotsPath || undefined,
      properties: ["openDirectory"],
    });
    const selectedPath = filePaths[0];

    if (canceled || !selectedPath) return;

    setScreenshotsPath(selectedPath);
    await updateUserPreferences({ screenshotsFolderPath: selectedPath });
  };

  const handleResetScreenshotsPath = async () => {
    await updateUserPreferences({ screenshotsFolderPath: undefined });
    setScreenshotsPath(await window.electron.getScreenshotsFolderPath());
  };

  const handleOpenScreenshotsFolder = async () => {
    try {
      await window.electron.openScreenshotsFolder();
    } catch (error) {
      logger.error("Failed to open the screenshots folder", error);
    }
  };

  const hasCustomScreenshotsPath = Boolean(
    userPreferences?.screenshotsFolderPath
  );
  const isCaptureDisabled = !form.enabled;

  const visibilityOptions = SCREENSHOT_VISIBILITY_OPTIONS.map((visibility) => ({
    key: visibility,
    value: visibility,
    label: tCapture(`visibility_${visibility.toLowerCase()}`),
  }));

  return (
    <div className="settings-context-panel settings-screenshots">
      <div className="settings-context-panel__group">
        <h3>{t("screenshots_capture_group")}</h3>

        <CheckboxField
          label={t("screenshots_enable")}
          checked={form.enabled}
          onChange={() =>
            savePreferences(
              { enabled: !form.enabled },
              { screenshotsEnabled: !form.enabled }
            )
          }
        />

        <SettingsScreenshotsHotkey
          binding={form.hotkey}
          disabled={isCaptureDisabled}
          onChange={handleHotkeyChange}
        />

        <ScreenshotInputStatusLine status={inputStatus} />

        <CheckboxField
          label={t("screenshots_gamepad_enable")}
          checked={form.gamepadEnabled}
          disabled={isCaptureDisabled}
          onChange={() =>
            savePreferences(
              { gamepadEnabled: !form.gamepadEnabled },
              { screenshotGamepadEnabled: !form.gamepadEnabled }
            )
          }
        />

        <SettingsScreenshotsGamepad
          combo={form.gamepadCombo}
          disabled={isCaptureDisabled || !form.gamepadEnabled}
          onChange={handleGamepadComboChange}
        />

        <CheckboxField
          label={t("screenshots_capture_sound")}
          checked={form.captureSoundEnabled}
          disabled={isCaptureDisabled}
          onChange={() =>
            savePreferences(
              { captureSoundEnabled: !form.captureSoundEnabled },
              { screenshotCaptureSoundEnabled: !form.captureSoundEnabled }
            )
          }
        />

        <CheckboxField
          label={t("screenshots_toast")}
          checked={form.toastEnabled}
          disabled={isCaptureDisabled}
          onChange={() =>
            savePreferences(
              { toastEnabled: !form.toastEnabled },
              { screenshotToastEnabled: !form.toastEnabled }
            )
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("screenshots_upload_group")}</h3>

        <SelectField
          className="settings-screenshots__select"
          label={t("screenshots_default_visibility")}
          value={form.defaultVisibility}
          options={visibilityOptions}
          onChange={(event) => {
            const { value } = event.target;
            if (!isScreenshotVisibility(value)) return;

            savePreferences(
              { defaultVisibility: value },
              { screenshotDefaultVisibility: value }
            );
          }}
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("screenshots_folder_group")}</h3>

        <div className="settings-screenshots__folder">
          <TextField
            label={t("screenshots_directory")}
            value={screenshotsPath}
            readOnly
            disabled
            rightContent={
              <>
                <Button theme="outline" onClick={handleChooseScreenshotsPath}>
                  <FileDirectoryIcon size={14} />
                  {t("change_screenshots_directory")}
                </Button>
                {hasCustomScreenshotsPath && (
                  <Button
                    className="settings-screenshots__icon-button"
                    theme="outline"
                    tooltip={t("reset_screenshots_directory")}
                    aria-label={t("reset_screenshots_directory")}
                    onClick={handleResetScreenshotsPath}
                  >
                    <HistoryIcon size={14} />
                  </Button>
                )}
              </>
            }
          />

          <Button
            className="settings-screenshots__open-folder"
            theme="outline"
            onClick={handleOpenScreenshotsFolder}
          >
            <FileDirectoryIcon size={14} />
            {t("open_screenshots_directory")}
          </Button>
        </div>
      </div>
    </div>
  );
}
