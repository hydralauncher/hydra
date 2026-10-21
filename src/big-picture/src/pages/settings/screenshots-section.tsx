import "./screenshots-section.scss";

import {
  ArrowCounterClockwiseIcon,
  CloudArrowUpIcon,
  FolderOpenIcon,
  ImageIcon,
  KeyboardIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  LocalScreenshot,
  ProfileVisibility,
  ScreenshotGamepadButton,
  ScreenshotInputStatus,
  UserPreferences,
} from "@types";
import {
  DEFAULT_SCREENSHOT_GAMEPAD_COMBO,
  DEFAULT_SCREENSHOT_HOTKEY,
  SCREENSHOT_GAMEPAD_BUTTONS,
  SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS,
  SCREENSHOT_GAMEPAD_COMBO_MIN_BUTTONS,
  formatScreenshotHotkey,
  isSameScreenshotGamepadCombo,
  isSameScreenshotHotkey,
  isScreenshotUploadRetryable,
  resolveScreenshotPreferences,
  toLocalScreenshotUrl,
  useLocalScreenshotViewer,
  validateScreenshotGamepadCombo,
  validateScreenshotHotkey,
  type ScreenshotHotkeyError,
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
  getHotkeyFromKeyboardEvent,
  getLocalScreenshotStatusDetail,
  isModifierKeyCode,
} from "../../components/pages/screenshots";
import {
  useBigPictureToast,
  useNavigation,
  useNavigationScreenActions,
  useUserDetails,
  useUserPreferences,
} from "../../hooks";
import {
  NavigationService,
  type FocusOverrides,
  type FocusOverrideTarget,
} from "../../services";
import { ScreenshotDialogPresence } from "../../components/pages/screenshots/screenshot-dialog-presence";
import { LocalScreenshotViewer } from "./local-screenshot-viewer";
import { SettingsSection } from "./settings-section";

export const SCREENSHOT_SETTINGS_FOCUS_IDS = {
  enabled: "screenshot-settings-enabled",
  hotkey: "screenshot-settings-hotkey",
  hotkeyReset: "screenshot-settings-hotkey-reset",
  gamepadEnabled: "screenshot-settings-gamepad-enabled",
  gamepadAdd: "screenshot-settings-gamepad-add",
  gamepadReset: "screenshot-settings-gamepad-reset",
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
const navigationService = NavigationService.getInstance();
const HOTKEY_ERROR_KEYS: Record<ScreenshotHotkeyError, string> = {
  hotkey_reserved: "screenshots_hotkey_error_reserved",
  hotkey_modifier_required: "screenshots_hotkey_error_typing",
  hotkey_unsupported_key: "screenshots_hotkey_error_unsupported",
};
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

const getGamepadSlotFocusId = (index: number) =>
  `screenshot-settings-gamepad-slot:${index}`;
const getGamepadRemoveFocusId = (index: number) =>
  `screenshot-settings-gamepad-remove:${index}`;

const getLocalViewFocusId = (clientId: string) =>
  `screenshot-settings-local-view:${clientId}`;
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

function withoutPreferenceKeys(
  overrides: ScreenshotPreferenceUpdate,
  failed: ScreenshotPreferenceUpdate
): ScreenshotPreferenceUpdate {
  const failedKeys = new Set(Object.keys(failed));

  return Object.fromEntries(
    Object.entries(overrides).filter(([key]) => !failedKeys.has(key))
  ) as ScreenshotPreferenceUpdate;
}

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
  screenshot.state === "local" ||
  (screenshot.state === "failed" &&
    isScreenshotUploadRetryable(screenshot.lastError));

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

    const recordingLayerId = navigationService.getActiveLayerId();
    const isRecordingLayerActive = () =>
      navigationService.getActiveLayerId() === recordingLayerId;
    const unsubscribe = navigationService.subscribe(() => {
      if (!isRecordingLayerActive()) setIsRecording(false);
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isRecordingLayerActive()) return;

      event.preventDefault();
      event.stopPropagation();

      if (event.code === "Escape" && !event.ctrlKey && !event.altKey) {
        setIsRecording(false);
        return;
      }

      if (isModifierKeyCode(event.code)) return;

      const candidate = getHotkeyFromKeyboardEvent(event);
      const validation = validateScreenshotHotkey(candidate);
      const { meta: _meta, ...binding } = candidate;
      const error = validation.valid ? null : validation.error;

      setIsRecording(false);
      onRecorded(error);
      if (!error) save(binding);
    };

    globalThis.window.addEventListener("keydown", onKeyDown, true);
    return () => {
      unsubscribe();
      globalThis.window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [isRecording, onRecorded, save]);

  return { isRecording, setIsRecording };
}

const isSavableGamepadCombo = (combo: ScreenshotGamepadButton[]) =>
  new Set(combo).size === combo.length &&
  validateScreenshotGamepadCombo(combo).valid;

function useGamepadComboDraft(
  combo: ScreenshotGamepadButton[],
  onSave: (combo: ScreenshotGamepadButton[]) => void
) {
  const [draft, setDraft] = useState<ScreenshotGamepadButton[]>(combo);
  const savedComboKey = combo.join(",");
  const savedComboRef = useRef(combo);
  savedComboRef.current = combo;

  useEffect(() => {
    const savedCombo = savedComboRef.current;
    setDraft((current) =>
      isSameScreenshotGamepadCombo(current, savedCombo) ? current : savedCombo
    );
  }, [savedComboKey]);

  const commit = (next: ScreenshotGamepadButton[]) => {
    setDraft(next);
    if (isSavableGamepadCombo(next)) onSave(next);
  };

  const unusedButton = SCREENSHOT_GAMEPAD_BUTTONS.find(
    (button) => !draft.includes(button)
  );

  return {
    draft,
    hasDuplicates: new Set(draft).size !== draft.length,
    isDefault: isSameScreenshotGamepadCombo(
      draft,
      DEFAULT_SCREENSHOT_GAMEPAD_COMBO
    ),
    canAdd:
      draft.length < SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS &&
      unusedButton !== undefined,
    select: (index: number, button: ScreenshotGamepadButton) =>
      commit(
        draft.map((current, position) =>
          position === index ? button : current
        )
      ),
    add: () => {
      if (unusedButton) commit([...draft, unusedButton]);
    },
    remove: (index: number) =>
      commit(draft.filter((_, position) => position !== index)),
    reset: () => commit([...DEFAULT_SCREENSHOT_GAMEPAD_COMBO]),
  };
}

function useScreenshotInputStatus() {
  const [status, setStatus] = useState<ScreenshotInputStatus | null>(null);

  useEffect(() => {
    let isCurrent = true;

    globalThis.window.electron
      .getScreenshotInputStatus()
      .then((nextStatus) => {
        if (isCurrent) setStatus(nextStatus);
      })
      .catch((error: unknown) => {
        logger.error("Failed to read the screenshot input status", error);
      });

    const unsubscribe =
      globalThis.window.electron.onScreenshotInputStatusChange(setStatus);

    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, []);

  return status;
}

function getInputStatusKey(status: ScreenshotInputStatus) {
  if (status.active) return "screenshots_input_active";
  if (status.keyboardBackend === "unavailable")
    return "screenshots_input_unavailable";

  return "screenshots_input_idle";
}

function ScreenshotInputStatusLine({
  status,
}: Readonly<{ status: ScreenshotInputStatus | null }>) {
  const { t } = useTranslation("settings");

  if (!status) return null;

  return (
    <span className="screenshot-settings__status">
      <span className="screenshot-settings__hint">
        {t(getInputStatusKey(status))}
      </span>
      {!status.active && status.hint ? (
        <span className="screenshot-settings__hint">
          {t(status.hint, { ns: "screenshots_input" })}
        </span>
      ) : null}
    </span>
  );
}

interface LocalScreenshotRowProps {
  screenshot: LocalScreenshot;
  isSignedIn: boolean;
  language: string;
  navigation: Record<string, FocusOverrides>;
  onView: (screenshot: LocalScreenshot) => void;
  onUpload: (screenshot: LocalScreenshot) => void;
  onDelete: (screenshot: LocalScreenshot) => void;
}

function getLocalScreenshotTitle(
  screenshot: LocalScreenshot,
  t: (key: string) => string
) {
  return (
    screenshot.customGameTitle ||
    screenshot.gameTitle ||
    t("screenshots_custom_game")
  );
}

function LocalScreenshotRow({
  screenshot,
  isSignedIn,
  language,
  navigation,
  onView,
  onUpload,
  onDelete,
}: Readonly<LocalScreenshotRowProps>) {
  const { t } = useTranslation("big_picture");
  const [hasImageError, setHasImageError] = useState(false);
  const source = toLocalScreenshotUrl(screenshot.path);
  const viewFocusId = getLocalViewFocusId(screenshot.clientId);
  const uploadFocusId = getLocalUploadFocusId(screenshot.clientId);
  const deleteFocusId = getLocalDeleteFocusId(screenshot.clientId);
  const title = getLocalScreenshotTitle(screenshot, t);
  const canUpload = canUploadLocalScreenshot(screenshot);
  const statusDetail = getLocalScreenshotStatusDetail(screenshot, t);

  return (
    <li className="screenshot-settings__local-item">
      <FocusItem
        id={viewFocusId}
        navigationOverrides={navigation[viewFocusId]}
        asChild
      >
        <button
          type="button"
          className="screenshot-settings__local-thumbnail"
          aria-label={t("screenshots_settings_view_local")}
          title={t("screenshots_settings_view_local")}
          onClick={() => onView(screenshot)}
        >
          {hasImageError ? (
            <ImageIcon size={20} />
          ) : (
            <img
              src={source}
              alt=""
              loading="lazy"
              draggable={false}
              onError={() => setHasImageError(true)}
            />
          )}
        </button>
      </FocusItem>
      <span className="screenshot-settings__local-copy">
        <strong title={title}>{title}</strong>
        <small>
          {formatScreenshotDate(screenshot.capturedAt, language)}
          {" · "}
          {t(getLocalStatusKey(screenshot), {
            progress: Math.round((screenshot.uploadProgress ?? 0) * 100),
          })}
        </small>
        {statusDetail ? <small>{statusDetail}</small> : null}
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

interface ScreenshotSettingsRowsOptions {
  isDefaultHotkey: boolean;
  hasCustomFolder: boolean;
  localScreenshots: LocalScreenshot[];
  comboDraft: ScreenshotGamepadButton[];
  canAddComboButton: boolean;
  isDefaultCombo: boolean;
  settingsDisabled: boolean;
  isGamepadComboDisabled: boolean;
  isSignedIn: boolean;
}

const ids = SCREENSHOT_SETTINGS_FOCUS_IDS;

const getLocalScreenshotRow = (screenshot: LocalScreenshot) =>
  canUploadLocalScreenshot(screenshot)
    ? [
        getLocalViewFocusId(screenshot.clientId),
        getLocalUploadFocusId(screenshot.clientId),
        getLocalDeleteFocusId(screenshot.clientId),
      ]
    : [
        getLocalViewFocusId(screenshot.clientId),
        getLocalDeleteFocusId(screenshot.clientId),
      ];

const getComboRow = (comboDraft: ScreenshotGamepadButton[]) =>
  comboDraft.flatMap((_, index) =>
    index >= SCREENSHOT_GAMEPAD_COMBO_MIN_BUTTONS
      ? [getGamepadSlotFocusId(index), getGamepadRemoveFocusId(index)]
      : [getGamepadSlotFocusId(index)]
  );

const getComboActionsRow = (
  canAddComboButton: boolean,
  isDefaultCombo: boolean
) => {
  const row: string[] = [];
  if (canAddComboButton) row.push(ids.gamepadAdd);
  if (!isDefaultCombo) row.push(ids.gamepadReset);
  return row;
};

function getInactiveFocusIds(
  options: ScreenshotSettingsRowsOptions,
  comboIds: string[]
) {
  const inactiveIds = new Set<string>();

  if (options.settingsDisabled) {
    inactiveIds.add(ids.hotkey);
    inactiveIds.add(ids.hotkeyReset);
    inactiveIds.add(ids.defaultVisibility);
  }
  if (options.isGamepadComboDisabled) {
    for (const focusId of comboIds) inactiveIds.add(focusId);
  }
  if (!options.isSignedIn) {
    for (const screenshot of options.localScreenshots)
      inactiveIds.add(getLocalUploadFocusId(screenshot.clientId));
  }

  return inactiveIds;
}

function buildScreenshotSettingsRows(options: ScreenshotSettingsRowsOptions) {
  const hotkeyRow = options.isDefaultHotkey
    ? [ids.hotkey]
    : [ids.hotkey, ids.hotkeyReset];
  const folderRow = options.hasCustomFolder
    ? [ids.folder, ids.folderReset, ids.folderOpen]
    : [ids.folder, ids.folderOpen];
  const comboRow = getComboRow(options.comboDraft);
  const comboActionsRow = getComboActionsRow(
    options.canAddComboButton,
    options.isDefaultCombo
  );
  const inactiveIds = getInactiveFocusIds(options, [
    ...comboRow,
    ...comboActionsRow,
  ]);

  return [
    [ids.enabled],
    hotkeyRow,
    [ids.gamepadEnabled],
    comboRow,
    comboActionsRow,
    [ids.captureSound],
    [ids.toast],
    [ids.borderFlash],
    [ids.askToUpload],
    [ids.defaultVisibility],
    folderRow,
    ...options.localScreenshots.map(getLocalScreenshotRow),
  ]
    .map((row) => row.filter((focusId) => !inactiveIds.has(focusId)))
    .filter((row) => row.length > 0);
}

interface SettingsLocalScreenshotViewerProps {
  viewer: ReturnType<typeof useLocalScreenshotViewer>;
  count: number;
  language: string;
  isSignedIn: boolean;
  isBlocked: boolean;
  onUpload: (screenshot: LocalScreenshot) => void;
  onDelete: (screenshot: LocalScreenshot) => void;
}

function getLocalScreenshotMeta(
  screenshot: LocalScreenshot,
  t: (key: string, options?: Record<string, unknown>) => string,
  language: string
) {
  const status = t(getLocalStatusKey(screenshot), {
    progress: Math.round((screenshot.uploadProgress ?? 0) * 100),
  });

  return `${formatScreenshotDate(screenshot.capturedAt, language)} · ${status}`;
}

function SettingsLocalScreenshotViewer({
  viewer,
  count,
  language,
  isSignedIn,
  isBlocked,
  onUpload,
  onDelete,
}: Readonly<SettingsLocalScreenshotViewerProps>) {
  const { t } = useTranslation("big_picture");
  const { current } = viewer;

  return (
    <LocalScreenshotViewer
      screenshot={current}
      index={viewer.index}
      count={count}
      title={current ? getLocalScreenshotTitle(current, t) : ""}
      meta={current ? getLocalScreenshotMeta(current, t, language) : ""}
      canUpload={current ? canUploadLocalScreenshot(current) : false}
      isSignedIn={isSignedIn}
      isBlocked={isBlocked}
      hasPrevious={viewer.hasPrevious}
      hasNext={viewer.hasNext}
      onPrevious={viewer.previous}
      onNext={viewer.next}
      onClose={viewer.close}
      onUpload={onUpload}
      onDelete={onDelete}
    />
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
  const { setFocus } = useNavigation();
  const [overrides, setOverrides] = useState<ScreenshotPreferenceUpdate>({});
  const [folderPath, setFolderPath] = useState("");
  const [deleting, setDeleting] = useState<LocalScreenshot | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const localScreenshots = useLocalScreenshotList();
  const viewer = useLocalScreenshotViewer(localScreenshots);
  const inputStatus = useScreenshotInputStatus();
  const isBorderFlashUnavailable = Boolean(
    globalThis.window.electron.isWayland
  );
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
      setFolderPath(await globalThis.window.electron.getScreenshotsPath());
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
        setOverrides((current) => withoutPreferenceKeys(current, values));
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

      showErrorToast(t(HOTKEY_ERROR_KEYS[error]), {
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

  const saveGamepadCombo = useCallback(
    (screenshotGamepadCombo: ScreenshotGamepadButton[]) => {
      void update({ screenshotGamepadCombo });
    },
    [update]
  );
  const gamepadCombo = useGamepadComboDraft(
    preferences.gamepadCombo,
    saveGamepadCombo
  );
  const isGamepadComboDisabled =
    settingsDisabled || !preferences.gamepadEnabled;

  const resetHotkey = () => {
    setIsRecording(false);
    void update({ screenshotHotkey: { ...DEFAULT_SCREENSHOT_HOTKEY } });
    globalThis.window.requestAnimationFrame(() =>
      setFocus(SCREENSHOT_SETTINGS_FOCUS_IDS.hotkey)
    );
  };

  const isDefaultHotkey = isSameScreenshotHotkey(
    preferences.hotkey,
    DEFAULT_SCREENSHOT_HOTKEY
  );
  const rows = useMemo(
    () =>
      buildScreenshotSettingsRows({
        isDefaultHotkey,
        hasCustomFolder,
        localScreenshots,
        comboDraft: gamepadCombo.draft,
        canAddComboButton: gamepadCombo.canAdd,
        isDefaultCombo: gamepadCombo.isDefault,
        settingsDisabled,
        isGamepadComboDisabled,
        isSignedIn: Boolean(userDetails),
      }),
    [
      gamepadCombo.canAdd,
      gamepadCombo.draft,
      gamepadCombo.isDefault,
      hasCustomFolder,
      isDefaultHotkey,
      isGamepadComboDisabled,
      localScreenshots,
      settingsDisabled,
      userDetails,
    ]
  );

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
    disabled = settingsDisabled,
    secondaryText?: string
  ) => (
    <Checkbox
      block
      label={label}
      secondaryText={secondaryText}
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
            <HorizontalFocusGroup asChild>
              <div className="screenshot-settings__controls">
                <FocusItem
                  id={ids.hotkey}
                  navigationState={settingsDisabled ? "disabled" : "active"}
                  navigationOverrides={navigation[ids.hotkey]}
                  asChild
                >
                  <button
                    type="button"
                    className={cn("screenshot-settings__keycap", {
                      "screenshot-settings__keycap--recording": isRecording,
                    })}
                    disabled={settingsDisabled}
                    aria-pressed={isRecording}
                    onClick={() => setIsRecording(!isRecording)}
                  >
                    <KeyboardIcon size={18} />
                    <span>
                      {isRecording
                        ? t("screenshots_settings_hotkey_recording")
                        : formatScreenshotHotkey(preferences.hotkey)}
                    </span>
                  </button>
                </FocusItem>
                {isDefaultHotkey ? null : (
                  <Button
                    variant="secondary"
                    size="small"
                    focusId={ids.hotkeyReset}
                    disabled={settingsDisabled}
                    focusNavigationOverrides={navigation[ids.hotkeyReset]}
                    onClick={resetHotkey}
                  >
                    {t("screenshots_settings_hotkey_reset")}
                  </Button>
                )}
              </div>
            </HorizontalFocusGroup>
            <span className="screenshot-settings__hint">
              {t(
                isRecording
                  ? "screenshots_settings_hotkey_recording_hint"
                  : "screenshots_settings_hotkey_hint"
              )}
            </span>
            <ScreenshotInputStatusLine status={inputStatus} />
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
            <HorizontalFocusGroup asChild>
              <div className="screenshot-settings__controls">
                {gamepadCombo.draft.map((button, index) => (
                  <div
                    key={`${index}-${button}`}
                    className="screenshot-settings__combo-slot"
                  >
                    {index > 0 ? (
                      <span className="screenshot-settings__plus" aria-hidden>
                        +
                      </span>
                    ) : null}
                    <DropdownSelect
                      className="screenshot-settings__select"
                      label={t("screenshots_settings_gamepad_slot", {
                        position: index + 1,
                      })}
                      hideLabel
                      ariaLabel={t("screenshots_settings_gamepad_slot", {
                        position: index + 1,
                      })}
                      value={button}
                      options={gamepadOptions}
                      disabled={isGamepadComboDisabled}
                      focusId={getGamepadSlotFocusId(index)}
                      focusNavigationOverrides={
                        navigation[getGamepadSlotFocusId(index)]
                      }
                      onValueChange={(next) => gamepadCombo.select(index, next)}
                    />
                    {index >= SCREENSHOT_GAMEPAD_COMBO_MIN_BUTTONS ? (
                      <Button
                        variant="secondary"
                        size="icon"
                        focusId={getGamepadRemoveFocusId(index)}
                        disabled={isGamepadComboDisabled}
                        icon={<XIcon size={18} />}
                        aria-label={t("screenshots_settings_gamepad_remove")}
                        title={t("screenshots_settings_gamepad_remove")}
                        focusNavigationOverrides={
                          navigation[getGamepadRemoveFocusId(index)]
                        }
                        onClick={() => gamepadCombo.remove(index)}
                      >
                        {null}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </HorizontalFocusGroup>
            {gamepadCombo.canAdd || !gamepadCombo.isDefault ? (
              <HorizontalFocusGroup asChild>
                <div className="screenshot-settings__controls">
                  {gamepadCombo.canAdd ? (
                    <Button
                      variant="secondary"
                      size="small"
                      focusId={ids.gamepadAdd}
                      disabled={isGamepadComboDisabled}
                      icon={<PlusIcon size={18} />}
                      focusNavigationOverrides={navigation[ids.gamepadAdd]}
                      onClick={gamepadCombo.add}
                    >
                      {t("screenshots_settings_gamepad_add")}
                    </Button>
                  ) : null}
                  {gamepadCombo.isDefault ? null : (
                    <Button
                      variant="secondary"
                      size="small"
                      focusId={ids.gamepadReset}
                      disabled={isGamepadComboDisabled}
                      focusNavigationOverrides={navigation[ids.gamepadReset]}
                      onClick={gamepadCombo.reset}
                    >
                      {t("screenshots_settings_gamepad_reset")}
                    </Button>
                  )}
                </div>
              </HorizontalFocusGroup>
            ) : null}
            {gamepadCombo.hasDuplicates ? (
              <span className="screenshot-settings__error" role="alert">
                {t("screenshots_settings_gamepad_duplicate")}
              </span>
            ) : null}
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
            preferences.borderFlashEnabled && !isBorderFlashUnavailable,
            (screenshotBorderFlashEnabled) =>
              void update({ screenshotBorderFlashEnabled }),
            settingsDisabled || isBorderFlashUnavailable,
            isBorderFlashUnavailable
              ? t("screenshots_border_flash_unavailable", { ns: "settings" })
              : undefined
          )}
          {renderCheckbox(
            ids.askToUpload,
            t("screenshots_settings_ask_to_upload"),
            preferences.askToUploadAfterGame,
            (screenshotAskToUploadAfterGame) =>
              void update({ screenshotAskToUploadAfterGame }),
            settingsDisabled,
            t("screenshots_settings_ask_to_upload_description")
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
            <HorizontalFocusGroup asChild>
              <div className="screenshot-settings__controls">
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
              </div>
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
                    onView={(target) => viewer.open(target.clientId)}
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

          <SettingsLocalScreenshotViewer
            viewer={viewer}
            count={localScreenshots.length}
            language={language}
            isSignedIn={Boolean(userDetails)}
            isBlocked={Boolean(deleting)}
            onUpload={(target) => void uploadLocal(target)}
            onDelete={setDeleting}
          />

          <ScreenshotDialogPresence isOpen={Boolean(deleting)} />
          <ConfirmationModal
            visible={Boolean(deleting)}
            backdropClassName="local-screenshot-viewer__confirmation-backdrop"
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
