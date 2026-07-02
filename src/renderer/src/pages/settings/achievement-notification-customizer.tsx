import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationCustomizer as AchievementNotificationCustomizerData,
  AchievementNotificationVariation,
  AchievementNotificationVariationSound,
  AchievementNotificationVariationStyle,
  Theme,
} from "@types";
import {
  ACHIEVEMENT_NOTIFICATION_VARIATIONS,
  DEFAULT_ACHIEVEMENT_NOTIFICATION_SOUND_VOLUME,
  DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER,
  getEffectiveAchievementNotificationSoundVolume,
  getAchievementNotificationCssVariables,
  getAchievementNotificationPosition,
  getAchievementNotificationSound,
  getAchievementNotificationStyle,
  getThemeAchievementNotificationCustomizer,
} from "@shared";
import { Button, SelectField, TextField } from "@renderer/components";
import { generateUUID } from "@renderer/helpers";
import { levelDBService } from "@renderer/services/leveldb.service";
import { AchievementNotificationItem } from "@renderer/components/achievements/notification/achievement-notification";
import hydraIcon from "@renderer/assets/icons/hydra.svg?url";
import {
  BellIcon,
  PlayIcon,
  Trash2Icon,
  Volume2Icon,
  XIcon,
} from "lucide-react";

import "./achievement-notification-customizer.scss";

interface AchievementNotificationCustomizerProps {
  enabled?: boolean;
  position?: AchievementCustomNotificationPosition;
}

const audioExtensions = ["wav", "mp3", "ogg", "m4a"];
const defaultProfileOption = "__default_profile__";
const newProfileOption = "__new_profile__";
const autosaveDelay = 600;
const defaultMasterAchievementSoundVolume = 0.15;
const scaleRange = { min: 0.6, max: 2, step: 0.05 };
const radiusRange = { min: 0, max: 40, step: 1 };
const outlineRange = { min: 0, max: 8, step: 1 };
const shadowRange = { min: 0, max: 100, step: 1 };
const soundVolumeRange = { min: 0, max: 100, step: 1 };
type SoundModeOption = "default" | "file" | "muted";
const colorPickerHexPattern = /^#[0-9a-fA-F]{6}/;
const colorPickerHexLength = 7;
const colorPickerDefaultFallback = "#000000";
const colorPickerFallbacks =
  DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations.main;
const positionOptions: AchievementCustomNotificationPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const getPreviewAchievement = (
  variation: AchievementNotificationVariation
) => ({
  title: variation === "platinum" ? "Game completed" : "Achievement unlocked",
  description:
    variation === "rare"
      ? "A rare hidden achievement preview"
      : "Live preview without sending a notification",
  iconUrl: hydraIcon,
  points: 2440,
  isHidden: variation === "rare",
  isRare: variation === "rare",
  isPlatinum: variation === "platinum",
});

const getSelectedSoundMode = (
  sound: AchievementNotificationVariationSound
): SoundModeOption => {
  if (sound.mode === "file") return "file";
  if (sound.mode === "muted") return "muted";
  return "default";
};

const getSoundForMode = (
  mode: SoundModeOption,
  sound: AchievementNotificationVariationSound
): AchievementNotificationVariationSound => {
  if (mode === "file") {
    return {
      ...sound,
      mode: "file",
      filePath: sound.filePath,
    };
  }

  if (mode === "muted") {
    return { ...sound, mode: "muted" };
  }

  return { ...sound, mode: "default" };
};

const getColorPickerValue = (color: string, fallback: string) => {
  if (colorPickerHexPattern.test(color)) {
    return color.slice(0, colorPickerHexLength);
  }

  if (colorPickerHexPattern.test(fallback)) {
    return fallback.slice(0, colorPickerHexLength);
  }

  return colorPickerDefaultFallback;
};

function mergeCustomizer(
  customizer: AchievementNotificationCustomizerData,
  variation: AchievementNotificationVariation,
  style: Partial<AchievementNotificationVariationStyle>
): AchievementNotificationCustomizerData {
  return {
    ...customizer,
    variations: {
      ...customizer.variations,
      [variation]: {
        ...customizer.variations[variation],
        ...style,
      },
    },
  };
}

function updateSound(
  customizer: AchievementNotificationCustomizerData,
  variation: AchievementNotificationVariation,
  sound: AchievementNotificationVariationSound
): AchievementNotificationCustomizerData {
  return {
    ...customizer,
    sounds: {
      ...customizer.sounds,
      [variation]: sound,
    },
  };
}

const getProfileName = () => {
  const now = new Date();
  return `Achievement notifications ${now.toLocaleString()}`;
};

const getMasterAchievementSoundVolume = async () => {
  try {
    const preferences = (await levelDBService.get(
      "userPreferences",
      null,
      "json"
    )) as { achievementSoundVolume?: number } | null;

    return (
      preferences?.achievementSoundVolume ?? defaultMasterAchievementSoundVolume
    );
  } catch (error) {
    console.error("Failed to load achievement sound volume", error);
    return defaultMasterAchievementSoundVolume;
  }
};

const getAutosaveSnapshot = ({
  customizer,
  profileName,
}: {
  customizer: AchievementNotificationCustomizerData;
  profileName: string;
}) =>
  JSON.stringify({
    customizer,
    profileName,
  });

const getUpdatedProfile = (
  theme: Theme,
  snapshot: {
    customizer: AchievementNotificationCustomizerData;
    profileName: string;
  }
): Theme => ({
  ...theme,
  name: snapshot.profileName.trim() || theme.name,
  achievementNotificationCustomizer: snapshot.customizer,
  updatedAt: new Date(),
});

export function AchievementNotificationCustomizer({
  enabled = true,
  position,
}: Readonly<AchievementNotificationCustomizerProps>) {
  const { t } = useTranslation("achievement_notification_customizer");

  const [selectedVariation, setSelectedVariation] =
    useState<AchievementNotificationVariation>("main");
  const [profiles, setProfiles] = useState<Theme[]>([]);
  const [activeTheme, setActiveTheme] = useState<Theme | null>(null);
  const [isDefaultProfileSelected, setIsDefaultProfileSelected] =
    useState(true);
  const [profileName, setProfileName] = useState(getProfileName());
  const [isEditingProfileName, setIsEditingProfileName] = useState(false);
  const [customizer, setCustomizer] =
    useState<AchievementNotificationCustomizerData>(
      DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER
    );
  const profileNameInputRef = useRef<HTMLInputElement>(null);
  const autosaveTimeoutRef = useRef<NodeJS.Timeout>();
  const isAutosavingRef = useRef(false);
  const isCreatingProfileRef = useRef(false);
  const lastSavedSnapshotRef = useRef<string | null>(null);
  const loadingSnapshotRef = useRef<string | null>(null);

  const loadProfiles = useCallback(
    async (preferredThemeId?: string) => {
      const themes = (await levelDBService.values("themes")) as Theme[];
      const notificationProfiles = themes.filter(
        (theme) => theme.achievementNotificationCustomizer
      );
      const theme =
        preferredThemeId === defaultProfileOption
          ? null
          : (notificationProfiles.find(
              (currentTheme) => currentTheme.id === preferredThemeId
            ) ??
            notificationProfiles.find(
              (currentTheme) =>
                currentTheme.achievementNotificationCustomizerActive
            ) ??
            null);

      const nextIsDefaultProfile = !theme;
      const nextProfileName = theme?.name ?? t("default_profile");
      const nextCustomizer = getThemeAchievementNotificationCustomizer(theme);

      loadingSnapshotRef.current = getAutosaveSnapshot({
        customizer: nextCustomizer,
        profileName: nextProfileName,
      });

      setProfiles(notificationProfiles);
      setActiveTheme(theme);
      setIsDefaultProfileSelected(nextIsDefaultProfile);
      setProfileName(nextProfileName);
      setCustomizer(nextCustomizer);
    },
    [t]
  );

  useEffect(() => {
    globalThis.document.title = t("window_title");
    loadProfiles();
  }, [loadProfiles, t]);

  useEffect(() => {
    if (isEditingProfileName) {
      profileNameInputRef.current?.focus();
      profileNameInputRef.current?.select();
    }
  }, [isEditingProfileName]);

  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, []);

  const profileOptions = useMemo(
    () => [
      {
        key: defaultProfileOption,
        value: defaultProfileOption,
        label: t("default_profile"),
      },
      ...profiles.map((profile) => ({
        key: profile.id,
        value: profile.id,
        label: profile.achievementNotificationCustomizerActive
          ? t("active_profile_option", { name: profile.name })
          : profile.name,
      })),
      {
        key: newProfileOption,
        value: newProfileOption,
        label: t("new_profile"),
      },
    ],
    [profiles, t]
  );

  const selectedStyle = getAchievementNotificationStyle(
    customizer,
    selectedVariation
  );
  const selectedSound = getAchievementNotificationSound(
    customizer,
    selectedVariation
  );
  const selectedSoundVolume = Math.round(
    (selectedSound.volume ?? DEFAULT_ACHIEVEMENT_NOTIFICATION_SOUND_VOLUME) *
      100
  );
  const selectedPosition = getAchievementNotificationPosition(
    customizer,
    selectedVariation,
    position ?? "top-left"
  );

  const previewStyle = useMemo(
    () =>
      getAchievementNotificationCssVariables({
        ...selectedStyle,
        scale: 1,
      }) as CSSProperties,
    [selectedStyle]
  );

  const persistExistingProfile = useCallback(
    async (
      theme: Theme,
      snapshot: {
        customizer: AchievementNotificationCustomizerData;
        profileName: string;
      }
    ) => {
      await globalThis.electron.updateAchievementNotificationProfile(theme.id, {
        name: snapshot.profileName,
        customizer: snapshot.customizer,
      });
      await globalThis.electron.updateAchievementCustomNotificationWindow();
    },
    []
  );

  const handlePositionChange = (
    nextPosition: AchievementCustomNotificationPosition
  ) => {
    updateSelectedStyle({ position: nextPosition });
  };

  const handleProfileChange = async (profileId: string) => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = undefined;
    }

    const currentSnapshot = {
      customizer,
      profileName,
    };
    const currentSnapshotKey = getAutosaveSnapshot(currentSnapshot);
    let nextProfiles = profiles;

    if (
      activeTheme &&
      lastSavedSnapshotRef.current !== currentSnapshotKey &&
      loadingSnapshotRef.current !== currentSnapshotKey
    ) {
      const updatedProfile = getUpdatedProfile(activeTheme, currentSnapshot);
      nextProfiles = profiles.map((profile) =>
        profile.id === activeTheme.id ? updatedProfile : profile
      );

      setProfiles(nextProfiles);
      lastSavedSnapshotRef.current = currentSnapshotKey;
      await persistExistingProfile(activeTheme, currentSnapshot);
    }

    if (profileId === defaultProfileOption) {
      loadingSnapshotRef.current = getAutosaveSnapshot({
        customizer: DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER,
        profileName: t("default_profile"),
      });

      setActiveTheme(null);
      setIsDefaultProfileSelected(true);
      setProfileName(t("default_profile"));
      setIsEditingProfileName(false);
      setCustomizer(DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER);
      return;
    }

    if (profileId === newProfileOption) {
      const nextProfileName = getProfileName();
      const nextSnapshot = {
        customizer: DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER,
        profileName: nextProfileName,
      };

      loadingSnapshotRef.current = getAutosaveSnapshot(nextSnapshot);
      isCreatingProfileRef.current = true;

      try {
        await createProfile(nextSnapshot);
        setIsDefaultProfileSelected(false);
        setIsEditingProfileName(true);
      } finally {
        isCreatingProfileRef.current = false;
      }
      return;
    }

    const profile =
      nextProfiles.find((currentProfile) => currentProfile.id === profileId) ??
      null;

    const nextProfileName = profile?.name ?? getProfileName();
    const nextCustomizer = getThemeAchievementNotificationCustomizer(profile);

    loadingSnapshotRef.current = getAutosaveSnapshot({
      customizer: nextCustomizer,
      profileName: nextProfileName,
    });

    setActiveTheme(profile);
    setIsDefaultProfileSelected(false);
    setProfileName(nextProfileName);
    setIsEditingProfileName(false);
    setCustomizer(nextCustomizer);
  };

  const handlePickSoundFile = async () => {
    const { filePaths, canceled } = await globalThis.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: t("audio_files"), extensions: audioExtensions }],
    });

    if (!canceled && filePaths[0]) {
      updateSelectedSound({
        ...selectedSound,
        mode: "file",
        filePath: filePaths[0],
      });
    }
  };

  const handlePreviewSound = async () => {
    if (selectedSound.mode === "muted") return;

    const defaultSound = (
      await import("@renderer/assets/audio/achievement.wav")
    ).default;

    let soundUrl: string | null = null;

    if (activeTheme) {
      soundUrl =
        await globalThis.electron.getAchievementNotificationSoundDataUrl(
          activeTheme.id,
          selectedVariation,
          selectedSound
        );
    } else if (selectedSound.mode === "file") {
      soundUrl =
        await globalThis.electron.getAchievementNotificationSoundDataUrl(
          "",
          selectedVariation,
          selectedSound
        );
    }

    if (soundUrl === "") return;

    const masterVolume = await getMasterAchievementSoundVolume();
    const audio = new Audio(soundUrl ?? defaultSound);
    audio.volume = getEffectiveAchievementNotificationSoundVolume(
      masterVolume,
      selectedSound.volume
    );
    audio.play();
  };

  const handleSoundVolumeChange = (nextVolume: number) => {
    updateSelectedSound({
      ...selectedSound,
      volume: nextVolume / 100,
    });
  };

  const saveExistingProfile = useCallback(
    async (
      theme: Theme,
      snapshot: {
        customizer: AchievementNotificationCustomizerData;
        profileName: string;
      }
    ) => {
      const updatedProfile = getUpdatedProfile(theme, snapshot);
      setProfiles((currentProfiles) =>
        currentProfiles.map((profile) =>
          profile.id === theme.id ? updatedProfile : profile
        )
      );
      setActiveTheme(updatedProfile);
      await persistExistingProfile(theme, snapshot);
    },
    [persistExistingProfile]
  );

  const createProfile = useCallback(
    async (
      snapshot: {
        customizer: AchievementNotificationCustomizerData;
        profileName: string;
      },
      activate = false
    ) => {
      const now = new Date();
      const theme: Theme = {
        id: generateUUID(),
        name: snapshot.profileName.trim() || getProfileName(),
        isActive: false,
        achievementNotificationCustomizerActive: activate,
        code: "",
        achievementNotificationCustomizer: snapshot.customizer,
        createdAt: now,
        updatedAt: now,
      };

      await globalThis.electron.addCustomTheme(theme);
      await globalThis.electron.updateAchievementNotificationProfile(theme.id, {
        name: theme.name,
        customizer: snapshot.customizer,
        achievementNotificationCustomizerActive: activate,
      });
      await globalThis.electron.updateAchievementCustomNotificationWindow();
      await loadProfiles(theme.id);
    },
    [loadProfiles]
  );

  const createProfileFromDefault = useCallback(
    (
      override: Partial<{
        customizer: AchievementNotificationCustomizerData;
        profileName: string;
      }> = {}
    ) => {
      if (!isDefaultProfileSelected) return;

      const snapshot = {
        customizer,
        profileName: getProfileName(),
        ...override,
      };
      const snapshotKey = getAutosaveSnapshot(snapshot);

      loadingSnapshotRef.current = snapshotKey;
      lastSavedSnapshotRef.current = snapshotKey;
      isCreatingProfileRef.current = true;

      setActiveTheme(null);
      setIsDefaultProfileSelected(false);
      setProfileName(snapshot.profileName);
      setCustomizer(snapshot.customizer);

      createProfile(snapshot, false)
        .catch((error) => {
          console.error(
            "Failed to create achievement notification profile",
            error
          );
        })
        .finally(() => {
          isCreatingProfileRef.current = false;
        });
    },
    [createProfile, customizer, isDefaultProfileSelected]
  );

  const updateSelectedStyle = (
    style: Partial<AchievementNotificationVariationStyle>
  ) => {
    if (isDefaultProfileSelected) {
      const nextCustomizer = mergeCustomizer(
        customizer,
        selectedVariation,
        style
      );
      createProfileFromDefault({ customizer: nextCustomizer });
      return;
    }

    setCustomizer((current) =>
      mergeCustomizer(current, selectedVariation, style)
    );
  };

  const updateSelectedSound = (
    sound: AchievementNotificationVariationSound
  ) => {
    if (isDefaultProfileSelected) {
      const nextCustomizer = updateSound(customizer, selectedVariation, sound);
      createProfileFromDefault({ customizer: nextCustomizer });
      return;
    }

    setCustomizer((current) => updateSound(current, selectedVariation, sound));
  };

  const activateProfile = async () => {
    if (!activeTheme) return;

    await globalThis.electron.updateAchievementNotificationProfile(
      activeTheme.id,
      {
        name: activeTheme.name,
        customizer,
        achievementNotificationCustomizerActive: true,
      }
    );
    await globalThis.electron.updateAchievementCustomNotificationWindow();
    await loadProfiles(activeTheme.id);
  };

  const handleDeleteProfile = async () => {
    if (!activeTheme || isDefaultProfileSelected) return;

    const shouldDelete = globalThis.confirm(
      t("delete_profile_confirm", { name: activeTheme.name })
    );

    if (!shouldDelete) return;

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = undefined;
    }

    await globalThis.electron.deleteCustomTheme(activeTheme.id);
    await globalThis.electron.updateAchievementCustomNotificationWindow();
    await loadProfiles(defaultProfileOption);
  };

  const handleProfileNameKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "Enter" || event.key === "Escape") {
      setIsEditingProfileName(false);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    if (isDefaultProfileSelected) return;
    if (isCreatingProfileRef.current) return;

    const snapshot = {
      customizer,
      profileName,
    };
    const snapshotKey = getAutosaveSnapshot(snapshot);

    if (loadingSnapshotRef.current === snapshotKey) {
      lastSavedSnapshotRef.current = snapshotKey;
      loadingSnapshotRef.current = null;
      return;
    }

    if (lastSavedSnapshotRef.current === snapshotKey) {
      return;
    }

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = setTimeout(async () => {
      isAutosavingRef.current = true;

      try {
        if (activeTheme) {
          await saveExistingProfile(activeTheme, snapshot);
        } else {
          await createProfile(snapshot);
        }

        lastSavedSnapshotRef.current = snapshotKey;
      } finally {
        isAutosavingRef.current = false;
      }
    }, autosaveDelay);
  }, [
    activeTheme,
    createProfile,
    customizer,
    enabled,
    isDefaultProfileSelected,
    profileName,
    saveExistingProfile,
  ]);

  const flushCurrentProfile = useCallback(async () => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
      autosaveTimeoutRef.current = undefined;
    }

    if (isDefaultProfileSelected || isCreatingProfileRef.current) {
      return;
    }

    const snapshot = {
      customizer,
      profileName,
    };
    const snapshotKey = getAutosaveSnapshot(snapshot);

    if (lastSavedSnapshotRef.current === snapshotKey) {
      return;
    }

    if (activeTheme) {
      await saveExistingProfile(activeTheme, snapshot);
    } else {
      await createProfile(snapshot);
    }

    lastSavedSnapshotRef.current = snapshotKey;
    loadingSnapshotRef.current = null;
  }, [
    activeTheme,
    createProfile,
    customizer,
    isDefaultProfileSelected,
    profileName,
    saveExistingProfile,
  ]);

  const handleTestLive = async () => {
    await flushCurrentProfile();
    await globalThis.electron.showAchievementTestNotification(
      selectedVariation,
      selectedPosition
    );
  };

  return (
    <section className="achievement-notification-customizer">
      <div className="achievement-notification-customizer__titlebar">
        <span>{t("window_title")}</span>
        <button
          type="button"
          onClick={() =>
            globalThis.electron.closeAchievementNotificationCustomizerWindow()
          }
          aria-label={t("close")}
          title={t("close")}
        >
          <XIcon size={16} />
        </button>
      </div>

      <div className="achievement-notification-customizer__header">
        <div>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
      </div>

      {!enabled && (
        <p className="achievement-notification-customizer__hint">
          {t("disabled_hint")}
        </p>
      )}

      {enabled && (
        <div className="achievement-notification-customizer__panel">
          <div className="achievement-notification-customizer__section achievement-notification-customizer__section--toolbar">
            <div className="achievement-notification-customizer__section-heading">
              <h2>{t("profiles")}</h2>
              <span>{t("profiles_hint")}</span>
            </div>

            <div className="achievement-notification-customizer__profile-field">
              <label>{t("profile")}</label>
              <div className="achievement-notification-customizer__profile-control">
                <div
                  onDoubleClick={() => {
                    if (!isDefaultProfileSelected) {
                      setIsEditingProfileName(true);
                    }
                  }}
                  title={
                    isDefaultProfileSelected
                      ? t("default_profile_read_only")
                      : t("double_click_rename")
                  }
                >
                  {isEditingProfileName ? (
                    <input
                      ref={profileNameInputRef}
                      value={profileName}
                      onBlur={() => setIsEditingProfileName(false)}
                      onChange={(event) => setProfileName(event.target.value)}
                      onKeyDown={handleProfileNameKeyDown}
                      aria-label={t("profile_name")}
                    />
                  ) : (
                    <SelectField
                      value={
                        isDefaultProfileSelected
                          ? defaultProfileOption
                          : (activeTheme?.id ?? newProfileOption)
                      }
                      options={profileOptions}
                      onChange={(event) =>
                        handleProfileChange(event.target.value)
                      }
                    />
                  )}
                </div>
                <button
                  type="button"
                  className="achievement-notification-customizer__delete-profile"
                  disabled={!activeTheme || isDefaultProfileSelected}
                  onClick={handleDeleteProfile}
                  aria-label={t("delete_profile")}
                  title={t("delete_profile")}
                >
                  <Trash2Icon size={16} />
                </button>
              </div>
            </div>

            <div className="achievement-notification-customizer__actions">
              <Button onClick={handleTestLive}>
                <BellIcon size={16} />
                {t("test_live")}
              </Button>
              <Button
                theme="outline"
                disabled={
                  !activeTheme ||
                  activeTheme.achievementNotificationCustomizerActive
                }
                onClick={activateProfile}
              >
                {t("activate_profile")}
              </Button>
            </div>
          </div>

          <div className="achievement-notification-customizer__section">
            <div className="achievement-notification-customizer__section-heading">
              <h2>{t("variation")}</h2>
              <span>{t("variation_hint")}</span>
            </div>
            <div className="achievement-notification-customizer__tabs">
              {ACHIEVEMENT_NOTIFICATION_VARIATIONS.map((variation) => (
                <Button
                  key={variation}
                  theme={
                    selectedVariation === variation ? "primary" : "outline"
                  }
                  onClick={() => setSelectedVariation(variation)}
                >
                  {t(`variation_${variation}`)}
                </Button>
              ))}
            </div>
          </div>

          <div className="achievement-notification-customizer__content">
            <div className="achievement-notification-customizer__controls">
              <div className="achievement-notification-customizer__section">
                <div className="achievement-notification-customizer__section-heading">
                  <h2>{t("display")}</h2>
                  <span>{t("display_hint")}</span>
                </div>

                <div className="achievement-notification-customizer__grid">
                  <SelectField
                    label={t("position")}
                    value={selectedPosition}
                    options={positionOptions.map((positionOption) => ({
                      key: positionOption,
                      value: positionOption,
                      label: t(`position_${positionOption.replace("-", "_")}`),
                    }))}
                    onChange={(event) =>
                      handlePositionChange(
                        event.target
                          .value as AchievementCustomNotificationPosition
                      )
                    }
                  />
                </div>

                <div className="achievement-notification-customizer__sliders">
                  <label className="achievement-notification-customizer__range">
                    {t("scale")}
                    <input
                      type="range"
                      min={scaleRange.min}
                      max={scaleRange.max}
                      step={scaleRange.step}
                      value={selectedStyle.scale}
                      onChange={(event) =>
                        updateSelectedStyle({
                          scale: Number(event.target.value),
                        })
                      }
                    />
                    <span>{Math.round(selectedStyle.scale * 100)}%</span>
                  </label>
                </div>
              </div>

              <div className="achievement-notification-customizer__section">
                <div className="achievement-notification-customizer__section-heading">
                  <h2>{t("colors_and_type")}</h2>
                  <span>{t("colors_and_type_hint")}</span>
                </div>

                <div className="achievement-notification-customizer__grid">
                  <TextField
                    label={t("background_color")}
                    type="color"
                    value={getColorPickerValue(
                      selectedStyle.background,
                      colorPickerFallbacks.background
                    )}
                    onChange={(event) =>
                      updateSelectedStyle({ background: event.target.value })
                    }
                  />
                  <TextField
                    label={t("accent")}
                    type="color"
                    value={getColorPickerValue(
                      selectedStyle.accentColor,
                      colorPickerFallbacks.accentColor
                    )}
                    onChange={(event) =>
                      updateSelectedStyle({ accentColor: event.target.value })
                    }
                  />
                  <TextField
                    label={t("title_color")}
                    type="color"
                    value={getColorPickerValue(
                      selectedStyle.titleColor,
                      colorPickerFallbacks.titleColor
                    )}
                    onChange={(event) =>
                      updateSelectedStyle({ titleColor: event.target.value })
                    }
                  />
                  <TextField
                    label={t("description_color")}
                    type="color"
                    value={getColorPickerValue(
                      selectedStyle.descriptionColor,
                      colorPickerFallbacks.descriptionColor
                    )}
                    onChange={(event) =>
                      updateSelectedStyle({
                        descriptionColor: event.target.value,
                      })
                    }
                  />
                </div>
              </div>

              <div className="achievement-notification-customizer__section">
                <div className="achievement-notification-customizer__section-heading">
                  <h2>{t("shape")}</h2>
                  <span>{t("shape_hint")}</span>
                </div>

                <div className="achievement-notification-customizer__sliders">
                  <label className="achievement-notification-customizer__range">
                    {t("radius")}
                    <input
                      type="range"
                      min={radiusRange.min}
                      max={radiusRange.max}
                      step={radiusRange.step}
                      value={selectedStyle.radius}
                      onChange={(event) =>
                        updateSelectedStyle({
                          radius: Number(event.target.value),
                        })
                      }
                    />
                    <span>{selectedStyle.radius}px</span>
                  </label>

                  <label className="achievement-notification-customizer__range">
                    {t("outline")}
                    <input
                      type="range"
                      min={outlineRange.min}
                      max={outlineRange.max}
                      step={outlineRange.step}
                      value={selectedStyle.outlineWidth}
                      onChange={(event) =>
                        updateSelectedStyle({
                          outlineWidth: Number(event.target.value),
                        })
                      }
                    />
                    <span>{selectedStyle.outlineWidth}px</span>
                  </label>

                  <label className="achievement-notification-customizer__range">
                    {t("shadow")}
                    <input
                      type="range"
                      min={shadowRange.min}
                      max={shadowRange.max}
                      step={shadowRange.step}
                      value={selectedStyle.shadowIntensity}
                      onChange={(event) =>
                        updateSelectedStyle({
                          shadowIntensity: Number(event.target.value),
                        })
                      }
                    />
                    <span>{selectedStyle.shadowIntensity}%</span>
                  </label>
                </div>

                <div className="achievement-notification-customizer__grid">
                  <TextField
                    label={t("outline_color")}
                    type="color"
                    value={getColorPickerValue(
                      selectedStyle.outlineColor,
                      colorPickerFallbacks.outlineColor
                    )}
                    onChange={(event) =>
                      updateSelectedStyle({ outlineColor: event.target.value })
                    }
                  />
                  <TextField
                    label={t("shadow_color")}
                    type="color"
                    value={getColorPickerValue(
                      selectedStyle.shadowColor,
                      colorPickerFallbacks.shadowColor
                    )}
                    onChange={(event) =>
                      updateSelectedStyle({ shadowColor: event.target.value })
                    }
                  />
                </div>
              </div>

              <div className="achievement-notification-customizer__section">
                <div className="achievement-notification-customizer__section-heading">
                  <h2>{t("sound")}</h2>
                  <span>{t("sound_hint")}</span>
                </div>

                <div className="achievement-notification-customizer__sound">
                  <SelectField
                    label={t("sound_mode")}
                    value={getSelectedSoundMode(selectedSound)}
                    options={[
                      {
                        key: "default",
                        value: "default",
                        label: t("sound_default"),
                      },
                      { key: "file", value: "file", label: t("sound_file") },
                      {
                        key: "muted",
                        value: "muted",
                        label: t("sound_muted"),
                      },
                    ]}
                    onChange={(event) =>
                      updateSelectedSound(
                        getSoundForMode(
                          event.target.value as SoundModeOption,
                          selectedSound
                        )
                      )
                    }
                  />

                  <label className="achievement-notification-customizer__range">
                    {t("sound_volume")}
                    <input
                      type="range"
                      min={soundVolumeRange.min}
                      max={soundVolumeRange.max}
                      step={soundVolumeRange.step}
                      value={selectedSoundVolume}
                      disabled={selectedSound.mode === "muted"}
                      onChange={(event) =>
                        handleSoundVolumeChange(Number(event.target.value))
                      }
                    />
                    <span>{selectedSoundVolume}%</span>
                  </label>

                  <div className="achievement-notification-customizer__actions">
                    <Button theme="outline" onClick={handlePickSoundFile}>
                      <Volume2Icon size={16} />
                      {t("choose_file")}
                    </Button>
                    <Button
                      theme="outline"
                      disabled={selectedSound.mode === "muted"}
                      onClick={handlePreviewSound}
                    >
                      <PlayIcon size={16} />
                      {t("preview_sound")}
                    </Button>
                  </div>

                  {selectedSound.mode === "file" && selectedSound.filePath && (
                    <span className="achievement-notification-customizer__file-path">
                      {selectedSound.filePath}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="achievement-notification-customizer__section achievement-notification-customizer__preview">
              <div className="achievement-notification-customizer__section-heading">
                <h2>{t("preview")}</h2>
                <span>{t("preview_hint")}</span>
              </div>

              <div className="achievement-notification-customizer__preview-stage">
                <AchievementNotificationItem
                  achievement={getPreviewAchievement(selectedVariation)}
                  isClosing={false}
                  position="top-left"
                  customStyle={previewStyle}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
