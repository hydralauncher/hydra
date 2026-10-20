import "./screenshots-section.scss";

import {
  ArrowCounterClockwiseIcon,
  CloudArrowUpIcon,
  FolderOpenIcon,
  ImageIcon,
  KeyboardIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  LocalScreenshot,
  ProfileVisibility,
  ScreenshotGamepadButton,
  UserPreferences,
} from "@types";
import {
  DEFAULT_SCREENSHOT_HOTKEY,
  SCREENSHOT_GAMEPAD_BUTTONS,
  resolveScreenshotPreferences,
} from "@shared";
import { logger } from "@renderer/logger";

import {
  Button,
  Checkbox,
  DropdownSelect,
  FocusItem,
  HorizontalFocusGroup,
  VerticalFocusGroup,
  type DropdownSelectOption,
} from "../../components";
import { ConfirmationModal } from "../../components/modals";
import {
  formatScreenshotDate,
  formatScreenshotHotkeyLabel,
  getHotkeyFromKeyboardEvent,
  isModifierKeyCode,
  isSameScreenshotHotkey,
  validateScreenshotHotkey,
  type ScreenshotHotkeyError,
} from "../../components/pages/screenshots";
import { resolveImageSource } from "../../helpers";
import {
  useBigPictureToast,
  useNavigationScreenActions,
  useUserDetails,
  useUserPreferences,
} from "../../hooks";
import type { FocusOverrides, FocusOverrideTarget } from "../../services";
import { SettingsSection } from "./settings-section";

export const SCREENSHOT_SETTINGS_FOCUS_IDS = {
  enabled: "screenshot-settings-enabled",
  hotkey: "screenshot-settings-hotkey",
  hotkeyReset: "screenshot-settings-hotkey-reset",
  gamepadEnabled: "screenshot-settings-gamepad-enabled",
  gamepadFirst: "screenshot-settings-gamepad-first",
  gamepadSecond: "screenshot-settings-gamepad-second",
  captureSound: "screenshot-settings-capture-sound",
  toast: "screenshot-settings-toast",
  borderFlash: "screenshot-settings-border-flash",
  askToUpload: "screenshot-settings-ask-to-upload",
  defaultVisibility: "screenshot-settings-default-visibility",
  folder: "screenshot-settings-folder",
  folderReset: "screenshot-settings-folder-reset",
  folderOpen: "screenshot-settings-folder-open",
} as const;

const SECTION_REGION_ID = "screenshot-settings-section";
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

const getLocalUploadFocusId = (clientId: string) =>
  `screenshot-settings-local-upload:${clientId}`;
const getLocalDeleteFocusId = (clientId: string) =>
  `screenshot-settings-local-delete:${clientId}`;

type ScreenshotPreferenceUpdate = Pick<
  UserPreferences,
  | "screenshotsEnabled"
  | "screenshotHotkey"
  | "screenshotGamepadEnabled"
  | "screenshotGamepadCombo"
  | "screenshotCaptureSoundEnabled"
  | "screenshotToastEnabled"
  | "screenshotBorderFlashEnabled"
  | "screenshotAskToUploadAfterGame"
  | "screenshotDefaultVisibility"
>;

function buildRowNavigation(
  rows: string[][],
  upTarget: FocusOverrideTarget,
  downTarget: FocusOverrideTarget
) {
  const overrides: Record<string, FocusOverrides> = {};

  rows.forEach((row, rowIndex) => {
    const previousRow = rows[rowIndex - 1];
    const nextRow = rows[rowIndex + 1];

    row.forEach((focusId, columnIndex) => {
      const up = previousRow?.[Math.min(columnIndex, previousRow.length - 1)];
      const down = nextRow?.[Math.min(columnIndex, nextRow.length - 1)];
      const left = row[columnIndex - 1];
      const right = row[columnIndex + 1];

      overrides[focusId] = {
        up: up ? { type: "item", itemId: up } : upTarget,
        down: down ? { type: "item", itemId: down } : downTarget,
        left: left ? { type: "item", itemId: left } : undefined,
        right: right ? { type: "item", itemId: right } : BLOCK_TARGET,
      };
    });
  });

  return overrides;
}

function getLocalStatusKey(screenshot: LocalScreenshot) {
  switch (screenshot.state) {
    case "reviewing":
      return "screenshots_local_status_reviewing";
    case "queued":
      return "screenshots_local_status_queued";
    case "uploading":
      return "screenshots_local_status_uploading";
    case "failed":
      return "screenshots_local_status_failed";
    case "uploaded":
      if (screenshot.moderationStatus === "APPROVED")
        return "screenshots_local_status_published";
      if (screenshot.moderationStatus === "BLOCKED")
        return "screenshots_local_status_blocked";
      return "screenshots_local_status_in_review";
    default:
      return "screenshots_local_status_local";
  }
}

const canUploadLocalScreenshot = (screenshot: LocalScreenshot) =>
  screenshot.state === "local" || screenshot.state === "failed";

function useLocalScreenshotList() {
  const [screenshots, setScreenshots] = useState<LocalScreenshot[]>([]);

  useEffect(() => {
    let isCurrent = true;

    globalThis.window.electron
      .getLocalScreenshots()
      .then((items) => {
        if (isCurrent) setScreenshots(items);
      })
      .catch((error: unknown) => {
        logger.error("Failed to load local screenshots", error);
      });

    const unsubscribeChange =
      globalThis.window.electron.onLocalScreenshotsChange(setScreenshots);
    const unsubscribeProgress =
      globalThis.window.electron.onScreenshotUploadProgress((progress) => {
        setScreenshots((current) =>
          current.map((item) =>
            item.clientId === progress.clientId
              ? {
                  ...item,
                  state: progress.state,
                  uploadProgress: progress.progress,
                }
              : item
          )
        );
      });

    return () => {
      isCurrent = false;
      unsubscribeChange();
      unsubscribeProgress();
    };
  }, []);

  return useMemo(
    () =>
      screenshots
        .filter((screenshot) => screenshot.state !== "deleted")
        .sort((left, right) => right.capturedAt - left.capturedAt),
    [screenshots]
  );
}

function useHotkeyRecorder(
  onRecorded: (error: ScreenshotHotkeyError | null) => void,
  save: (binding: UserPreferences["screenshotHotkey"]) => void
) {
  const [isRecording, setIsRecording] = useState(false);

  useNavigationScreenActions(
    isRecording ? { press: { b: () => setIsRecording(false) } } : {}
  );

  useEffect(() => {
    if (!isRecording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape" && !event.ctrlKey && !event.altKey) {
        setIsRecording(false);
        return;
      }

      if (isModifierKeyCode(event.code)) return;

      const binding = getHotkeyFromKeyboardEvent(event);
      const error = validateScreenshotHotkey(binding, event.metaKey);

      setIsRecording(false);
      onRecorded(error);
      if (!error) save(binding);
    };

    globalThis.window.addEventListener("keydown", onKeyDown, true);
    return () =>
      globalThis.window.removeEventListener("keydown", onKeyDown, true);
  }, [isRecording, onRecorded, save]);

  return { isRecording, setIsRecording };
}

interface LocalScreenshotRowProps {
  screenshot: LocalScreenshot;
  isSignedIn: boolean;
  language: string;
  navigation: Record<string, FocusOverrides>;
  onUpload: (screenshot: LocalScreenshot) => void;
  onDelete: (screenshot: LocalScreenshot) => void;
}

function LocalScreenshotRow({
  screenshot,
  isSignedIn,
  language,
  navigation,
  onUpload,
  onDelete,
}: Readonly<LocalScreenshotRowProps>) {
  const { t } = useTranslation("big_picture");
  const [hasImageError, setHasImageError] = useState(false);
  const source = resolveImageSource(screenshot.path);
  const uploadFocusId = getLocalUploadFocusId(screenshot.clientId);
  const deleteFocusId = getLocalDeleteFocusId(screenshot.clientId);
  const title =
    screenshot.customGameTitle ||
    screenshot.gameTitle ||
    t("screenshots_custom_game");
  const canUpload = canUploadLocalScreenshot(screenshot);

  return (
    <li className="screenshot-settings__local-item">
      <span className="screenshot-settings__local-thumbnail">
        {source && !hasImageError ? (
          <img
            src={source}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setHasImageError(true)}
          />
        ) : (
          <ImageIcon size={20} />
        )}
      </span>
      <span className="screenshot-settings__local-copy">
        <strong title={title}>{title}</strong>
        <small>
          {formatScreenshotDate(screenshot.capturedAt, language)}
          {" · "}
          {t(getLocalStatusKey(screenshot), {
            progress: Math.round((screenshot.uploadProgress ?? 0) * 100),
          })}
        </small>
      </span>
      <HorizontalFocusGroup className="screenshot-settings__local-actions">
        {canUpload ? (
          <Button
            variant="secondary"
            size="small"
            focusId={uploadFocusId}
            disabled={!isSignedIn}
            icon={<CloudArrowUpIcon size={18} />}
            title={t(
              isSignedIn
                ? "screenshots_review_upload"
                : "screenshots_settings_sign_in_to_upload"
            )}
            focusNavigationOverrides={navigation[uploadFocusId]}
            onClick={() => onUpload(screenshot)}
          >
            {t("screenshots_review_upload")}
          </Button>
        ) : null}
        <Button
          variant="danger"
          size="icon"
          focusId={deleteFocusId}
          icon={<TrashIcon size={18} />}
          aria-label={t("screenshots_settings_delete_local")}
          title={t("screenshots_settings_delete_local")}
          focusNavigationOverrides={navigation[deleteFocusId]}
          onClick={() => onDelete(screenshot)}
        >
          {null}
        </Button>
      </HorizontalFocusGroup>
    </li>
  );
}

interface ScreenshotSettingsSectionProps {
  upFocusId: string | null;
}

export function ScreenshotSettingsSection({
  upFocusId,
}: Readonly<ScreenshotSettingsSectionProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const userPreferences = useUserPreferences();
  const { userDetails } = useUserDetails();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const [overrides, setOverrides] = useState<ScreenshotPreferenceUpdate>({});
  const [folderPath, setFolderPath] = useState("");
  const [deleting, setDeleting] = useState<LocalScreenshot | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const localScreenshots = useLocalScreenshotList();
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const preferences = resolveScreenshotPreferences({
    ...userPreferences,
    ...overrides,
  });
  const hasCustomFolder = Boolean(userPreferences?.achievementScreenshotsPath);
  const settingsDisabled = !preferences.enabled;

  useEffect(() => {
    setOverrides({});
  }, [userPreferences]);

  const refreshFolderPath = useCallback(async () => {
    try {
      setFolderPath(
        await globalThis.window.electron.getScreenshotsFolderPath()
      );
    } catch (error) {
      logger.error("Failed to resolve the screenshots folder", error);
    }
  }, []);

  useEffect(() => {
    void refreshFolderPath();
  }, [refreshFolderPath, userPreferences?.achievementScreenshotsPath]);

  const update = useCallback(
    async (values: ScreenshotPreferenceUpdate) => {
      setOverrides((current) => ({ ...current, ...values }));

      try {
        await globalThis.window.electron.updateUserPreferences(values);
      } catch (error) {
        logger.error("Failed to save screenshot preferences", error);
        showErrorToast(t("screenshots_settings_save_failed"), {
          fallbackVisual: "settings",
        });
      }
    },
    [showErrorToast, t]
  );

  const handleRecorded = useCallback(
    (error: ScreenshotHotkeyError | null) => {
      if (!error) return;

      showErrorToast(t(`screenshots_hotkey_error_${error}`), {
        fallbackVisual: "settings",
      });
    },
    [showErrorToast, t]
  );

  const saveHotkey = useCallback(
    (binding: UserPreferences["screenshotHotkey"]) => {
      void update({ screenshotHotkey: binding });
    },
    [update]
  );

  const { isRecording, setIsRecording } = useHotkeyRecorder(
    handleRecorded,
    saveHotkey
  );

  const chooseFolder = async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      defaultPath: folderPath || undefined,
      properties: ["openDirectory"],
    });
    const selectedPath = result.filePaths[0];
    if (result.canceled || !selectedPath) return;

    await globalThis.window.electron.updateUserPreferences({
      achievementScreenshotsPath: selectedPath,
    });
    await refreshFolderPath();
  };

  const resetFolder = async () => {
    await globalThis.window.electron.updateUserPreferences({
      achievementScreenshotsPath: undefined,
    });
    await refreshFolderPath();
  };

  const uploadLocal = async (screenshot: LocalScreenshot) => {
    try {
      const queued = await globalThis.window.electron.uploadLocalScreenshot(
        screenshot.clientId,
        {
          isSpoiler: screenshot.isSpoiler,
          visibility: screenshot.visibility,
          customGameTitle: screenshot.customGameTitle,
        }
      );

      if (!queued) {
        showErrorToast(t("screenshots_settings_sign_in_to_upload"), {
          fallbackVisual: "settings",
        });
      }
    } catch (error) {
      logger.error("Failed to queue the screenshot upload", error);
      showErrorToast(t("screenshots_review_action_failed"), {
        fallbackVisual: "settings",
      });
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;

    setIsDeleting(true);

    try {
      await globalThis.window.electron.deleteLocalScreenshot(deleting.clientId);
      setDeleting(null);
      showSuccessToast(t("screenshots_settings_deleted_local"), {
        fallbackVisual: "settings",
      });
    } catch (error) {
      logger.error("Failed to delete the local screenshot", error);
      showErrorToast(t("screenshots_review_action_failed"), {
        fallbackVisual: "settings",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const gamepadOptions = useMemo<
    DropdownSelectOption<ScreenshotGamepadButton>[]
  >(
    () =>
      SCREENSHOT_GAMEPAD_BUTTONS.map((button) => ({
        value: button,
        label: t(`screenshots_gamepad_button_${button}`),
      })),
    [t]
  );

  const visibilityOptions = useMemo<DropdownSelectOption<ProfileVisibility>[]>(
    () => [
      { value: "PUBLIC", label: t("screenshots_visibility_public") },
      { value: "FRIENDS", label: t("screenshots_visibility_friends") },
      { value: "PRIVATE", label: t("screenshots_visibility_private") },
    ],
    [t]
  );

  const [firstButton, secondButton] = preferences.gamepadCombo;

  const updateCombo = (position: 0 | 1, button: ScreenshotGamepadButton) => {
    const combo: ScreenshotGamepadButton[] = [
      firstButton ?? "back",
      secondButton ?? "rb",
    ];
    const otherPosition = position === 0 ? 1 : 0;

    if (combo[otherPosition] === button) {
      combo[otherPosition] = combo[position];
    }
    combo[position] = button;

    void update({ screenshotGamepadCombo: combo });
  };

  const ids = SCREENSHOT_SETTINGS_FOCUS_IDS;
  const isDefaultHotkey = isSameScreenshotHotkey(
    preferences.hotkey,
    DEFAULT_SCREENSHOT_HOTKEY
  );
  const rows = useMemo(() => {
    const hotkeyRow = isDefaultHotkey
      ? [ids.hotkey]
      : [ids.hotkey, ids.hotkeyReset];
    const folderRow = hasCustomFolder
      ? [ids.folder, ids.folderReset, ids.folderOpen]
      : [ids.folder, ids.folderOpen];
    const localRows = localScreenshots.map((screenshot) =>
      canUploadLocalScreenshot(screenshot)
        ? [
            getLocalUploadFocusId(screenshot.clientId),
            getLocalDeleteFocusId(screenshot.clientId),
          ]
        : [getLocalDeleteFocusId(screenshot.clientId)]
    );

    const inactiveIds = new Set<string>();
    if (settingsDisabled) {
      inactiveIds.add(ids.hotkey);
      inactiveIds.add(ids.hotkeyReset);
      inactiveIds.add(ids.defaultVisibility);
    }
    if (settingsDisabled || !preferences.gamepadEnabled) {
      inactiveIds.add(ids.gamepadFirst);
      inactiveIds.add(ids.gamepadSecond);
    }
    if (!userDetails) {
      for (const screenshot of localScreenshots)
        inactiveIds.add(getLocalUploadFocusId(screenshot.clientId));
    }

    return [
      [ids.enabled],
      hotkeyRow,
      [ids.gamepadEnabled],
      [ids.gamepadFirst, ids.gamepadSecond],
      [ids.captureSound],
      [ids.toast],
      [ids.borderFlash],
      [ids.askToUpload],
      [ids.defaultVisibility],
      folderRow,
      ...localRows,
    ]
      .map((row) => row.filter((focusId) => !inactiveIds.has(focusId)))
      .filter((row) => row.length > 0);
  }, [
    hasCustomFolder,
    ids,
    isDefaultHotkey,
    localScreenshots,
    preferences.gamepadEnabled,
    settingsDisabled,
    userDetails,
  ]);

  const navigation = useMemo(
    () =>
      buildRowNavigation(
        rows,
        upFocusId ? { type: "item", itemId: upFocusId } : BLOCK_TARGET,
        BLOCK_TARGET
      ),
    [rows, upFocusId]
  );

  const renderCheckbox = (
    focusId: string,
    label: string,
    checked: boolean,
    onChange: (checked: boolean) => void,
    disabled = settingsDisabled
  ) => (
    <Checkbox
      block
      label={label}
      checked={checked}
      disabled={disabled}
      focusId={focusId}
      navigationOverrides={navigation[focusId]}
      onChange={onChange}
    />
  );

  return (
    <SettingsSection
      title={t("screenshots_settings_title")}
      description={t("screenshots_settings_description")}
    >
      <VerticalFocusGroup regionId={SECTION_REGION_ID} asChild>
        <div className="screenshot-settings">
          {renderCheckbox(
            ids.enabled,
            t("screenshots_settings_enabled"),
            preferences.enabled,
            (screenshotsEnabled) => void update({ screenshotsEnabled }),
            false
          )}

          <div className="screenshot-settings__row">
            <span className="screenshot-settings__label">
              {t("screenshots_settings_hotkey")}
            </span>
            <HorizontalFocusGroup className="screenshot-settings__controls">
              <Button
                variant="secondary"
                focusId={ids.hotkey}
                disabled={settingsDisabled}
                icon={<KeyboardIcon size={18} />}
                className="screenshot-settings__hotkey"
                focusNavigationOverrides={navigation[ids.hotkey]}
                onClick={() => setIsRecording(!isRecording)}
              >
                {isRecording
                  ? t("screenshots_settings_hotkey_recording")
                  : formatScreenshotHotkeyLabel(preferences.hotkey)}
              </Button>
              {isDefaultHotkey ? null : (
                <Button
                  variant="secondary"
                  size="icon"
                  focusId={ids.hotkeyReset}
                  disabled={settingsDisabled}
                  icon={<ArrowCounterClockwiseIcon size={18} />}
                  aria-label={t("screenshots_settings_hotkey_reset")}
                  title={t("screenshots_settings_hotkey_reset")}
                  focusNavigationOverrides={navigation[ids.hotkeyReset]}
                  onClick={() =>
                    void update({ screenshotHotkey: DEFAULT_SCREENSHOT_HOTKEY })
                  }
                >
                  {null}
                </Button>
              )}
            </HorizontalFocusGroup>
            <span className="screenshot-settings__hint">
              {t(
                isRecording
                  ? "screenshots_settings_hotkey_recording_hint"
                  : "screenshots_settings_hotkey_hint"
              )}
            </span>
          </div>

          {renderCheckbox(
            ids.gamepadEnabled,
            t("screenshots_settings_gamepad_enabled"),
            preferences.gamepadEnabled,
            (screenshotGamepadEnabled) =>
              void update({ screenshotGamepadEnabled })
          )}

          <div className="screenshot-settings__row">
            <span className="screenshot-settings__label">
              {t("screenshots_settings_gamepad_combo")}
            </span>
            <HorizontalFocusGroup className="screenshot-settings__controls">
              <DropdownSelect
                className="screenshot-settings__select"
                label={t("screenshots_settings_gamepad_first")}
                hideLabel
                ariaLabel={t("screenshots_settings_gamepad_first")}
                value={firstButton ?? "back"}
                options={gamepadOptions}
                disabled={settingsDisabled || !preferences.gamepadEnabled}
                focusId={ids.gamepadFirst}
                focusNavigationOverrides={navigation[ids.gamepadFirst]}
                onValueChange={(button) => updateCombo(0, button)}
              />
              <span className="screenshot-settings__plus" aria-hidden>
                +
              </span>
              <DropdownSelect
                className="screenshot-settings__select"
                label={t("screenshots_settings_gamepad_second")}
                hideLabel
                ariaLabel={t("screenshots_settings_gamepad_second")}
                value={secondButton ?? "rb"}
                options={gamepadOptions}
                disabled={settingsDisabled || !preferences.gamepadEnabled}
                focusId={ids.gamepadSecond}
                focusNavigationOverrides={navigation[ids.gamepadSecond]}
                onValueChange={(button) => updateCombo(1, button)}
              />
            </HorizontalFocusGroup>
          </div>

          {renderCheckbox(
            ids.captureSound,
            t("screenshots_settings_capture_sound"),
            preferences.captureSoundEnabled,
            (screenshotCaptureSoundEnabled) =>
              void update({ screenshotCaptureSoundEnabled })
          )}
          {renderCheckbox(
            ids.toast,
            t("screenshots_settings_toast"),
            preferences.toastEnabled,
            (screenshotToastEnabled) => void update({ screenshotToastEnabled })
          )}
          {renderCheckbox(
            ids.borderFlash,
            t("screenshots_settings_border_flash"),
            preferences.borderFlashEnabled,
            (screenshotBorderFlashEnabled) =>
              void update({ screenshotBorderFlashEnabled })
          )}
          {renderCheckbox(
            ids.askToUpload,
            t("screenshots_settings_ask_to_upload"),
            preferences.askToUploadAfterGame,
            (screenshotAskToUploadAfterGame) =>
              void update({ screenshotAskToUploadAfterGame })
          )}

          <DropdownSelect
            className="screenshot-settings__visibility"
            label={t("screenshots_settings_default_visibility")}
            value={preferences.defaultVisibility}
            options={visibilityOptions}
            disabled={settingsDisabled}
            focusId={ids.defaultVisibility}
            focusNavigationOverrides={navigation[ids.defaultVisibility]}
            onValueChange={(screenshotDefaultVisibility) =>
              void update({ screenshotDefaultVisibility })
            }
          />

          <div className="screenshot-settings__row">
            <span className="screenshot-settings__label">
              {t("screenshots_settings_folder")}
            </span>
            <HorizontalFocusGroup className="screenshot-settings__controls">
              <FocusItem
                id={ids.folder}
                actions={{ primary: () => void chooseFolder() }}
                navigationOverrides={navigation[ids.folder]}
                asChild
              >
                <button
                  type="button"
                  className="screenshot-settings__path"
                  title={folderPath}
                  onClick={() => void chooseFolder()}
                >
                  {folderPath}
                </button>
              </FocusItem>
              {hasCustomFolder ? (
                <Button
                  variant="secondary"
                  size="icon"
                  focusId={ids.folderReset}
                  icon={<ArrowCounterClockwiseIcon size={18} />}
                  aria-label={t("screenshots_settings_folder_reset")}
                  title={t("screenshots_settings_folder_reset")}
                  focusNavigationOverrides={navigation[ids.folderReset]}
                  onClick={() => void resetFolder()}
                >
                  {null}
                </Button>
              ) : null}
              <Button
                variant="secondary"
                focusId={ids.folderOpen}
                icon={<FolderOpenIcon size={18} />}
                focusNavigationOverrides={navigation[ids.folderOpen]}
                onClick={() =>
                  void globalThis.window.electron.openScreenshotsFolder()
                }
              >
                {t("screenshots_settings_folder_open")}
              </Button>
            </HorizontalFocusGroup>
          </div>

          <div className="screenshot-settings__local">
            <span className="screenshot-settings__label">
              {t("screenshots_settings_local_title")}
            </span>
            {userDetails ? null : (
              <span className="screenshot-settings__hint">
                {t("screenshots_settings_sign_in_to_upload")}
              </span>
            )}
            {localScreenshots.length > 0 ? (
              <ul className="screenshot-settings__local-list">
                {localScreenshots.map((screenshot) => (
                  <LocalScreenshotRow
                    key={screenshot.clientId}
                    screenshot={screenshot}
                    isSignedIn={Boolean(userDetails)}
                    language={language}
                    navigation={navigation}
                    onUpload={(target) => void uploadLocal(target)}
                    onDelete={setDeleting}
                  />
                ))}
              </ul>
            ) : (
              <span className="screenshot-settings__hint">
                {t("screenshots_settings_local_empty")}
              </span>
            )}
          </div>

          <ConfirmationModal
            visible={Boolean(deleting)}
            title={t("screenshots_settings_delete_local_title")}
            description={t("screenshots_settings_delete_local_description")}
            confirmLabel={t("screenshots_settings_delete_local")}
            cancelLabel={t("screenshots_cancel")}
            danger
            loading={isDeleting}
            onClose={() => setDeleting(null)}
            onConfirm={confirmDelete}
          />
        </div>
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
