import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDownIcon,
  BellIcon,
  PlayIcon,
  UploadIcon,
  UndoIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { Button, SelectField, TextField } from "@renderer/components";
import { getAchievementSoundVolume } from "@renderer/helpers";
import { levelDBService } from "@renderer/services/leveldb.service";
import {
  ACHIEVEMENT_NOTIFICATION_VARIATIONS,
  DEFAULT_ACHIEVEMENT_NOTIFICATION_CSS,
  getEffectiveAchievementNotificationCss,
  getAchievementNotificationPreviewFlags,
  parseAchievementNotificationManagedCss,
  updateAchievementNotificationManagedCss,
  type AchievementNotificationCssProperty,
} from "@shared";
import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationSoundMode,
  AchievementNotificationVariation,
  Theme,
} from "@types";

import "./achievement-notification-customizer.scss";

const positions: AchievementCustomNotificationPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

const colorFallback = /^#[0-9a-f]{6}/i;

const getSoundMode = (
  theme: Theme,
  variation: AchievementNotificationVariation
): AchievementNotificationSoundMode => {
  const mode = theme.achievementSounds?.[variation]?.mode;
  if (mode) return mode;
  if (variation !== "default") return "inherit";
  return theme.hasCustomSound ? "file" : "default";
};

type Props = {
  theme: Theme;
  code: string;
  variation: AchievementNotificationVariation;
  onCodeChange: (code: string) => void;
  onThemeChange: (theme: Theme) => void;
  onVariationChange: (variation: AchievementNotificationVariation) => void;
};

type RangeControlProps = {
  label: string;
  property: AchievementNotificationCssProperty;
  value: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  hasOverride: boolean;
  onChange: (
    property: AchievementNotificationCssProperty,
    value: string
  ) => void;
  onReset: (property: AchievementNotificationCssProperty) => void;
  resetLabel: string;
};

function RangeControl({
  label,
  property,
  value,
  min,
  max,
  step,
  suffix = "",
  hasOverride,
  onChange,
  onReset,
  resetLabel,
}: Readonly<RangeControlProps>) {
  return (
    <label className="achievement-notification-customizer__range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(property, event.target.value)}
      />
      <span>
        {property === "scale" ? Math.round(Number(value) * 100) : value}
        {suffix}
      </span>
      <Button
        theme="outline"
        disabled={!hasOverride}
        onClick={() => onReset(property)}
        aria-label={resetLabel}
        title={resetLabel}
      >
        <UndoIcon />
      </Button>
    </label>
  );
}

export function AchievementNotificationCustomizer({
  theme,
  code,
  variation,
  onCodeChange,
  onThemeChange,
  onVariationChange,
}: Readonly<Props>) {
  const { t } = useTranslation("achievement_notification_customizer");
  const { t: settingsT } = useTranslation("settings");
  const [isCustomizerOpen, setIsCustomizerOpen] = useState(false);
  const parsed = useMemo(
    () => parseAchievementNotificationManagedCss(code),
    [code]
  );
  const effective = useMemo(
    () => getEffectiveAchievementNotificationCss(parsed.variations, variation),
    [parsed.variations, variation]
  );
  const overrides = parsed.variations[variation];

  const updateProperty = (
    property: AchievementNotificationCssProperty,
    value?: string
  ) => {
    if (parsed.status === "invalid") return;
    onCodeChange(
      updateAchievementNotificationManagedCss(code, variation, property, value)
    );
  };

  const refreshTheme = async () => {
    const updatedTheme = (await levelDBService.get(
      theme.id,
      "themes"
    )) as Theme | null;
    if (updatedTheme) onThemeChange(updatedTheme);
  };

  const sound = theme.achievementSounds?.[variation];
  const [soundVolume, setSoundVolume] = useState(
    Math.round((sound?.volume ?? 1) * 100)
  );
  const soundVolumeTimeoutRef = useRef<NodeJS.Timeout>();
  const soundMode = getSoundMode(theme, variation);

  useEffect(() => {
    setSoundVolume(Math.round((sound?.volume ?? 1) * 100));
  }, [sound?.volume, variation]);

  useEffect(
    () => () => {
      if (soundVolumeTimeoutRef.current) {
        clearTimeout(soundVolumeTimeoutRef.current);
      }
    },
    []
  );

  const updateSound = async (
    mode: AchievementNotificationSoundMode,
    sourcePath?: string,
    volume = soundVolume / 100
  ) => {
    await globalThis.electron.setThemeAchievementSound(
      theme.id,
      variation,
      mode,
      sourcePath,
      volume
    );
    await refreshTheme();
  };

  const updateSoundVolume = (nextVolume: number) => {
    setSoundVolume(nextVolume);
    if (soundVolumeTimeoutRef.current) {
      clearTimeout(soundVolumeTimeoutRef.current);
    }
    soundVolumeTimeoutRef.current = setTimeout(() => {
      updateSound(soundMode, undefined, nextVolume / 100).catch(console.error);
    }, 300);
  };

  const chooseSound = async () => {
    const { filePaths, canceled } = await globalThis.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: t("audio_files"), extensions: ["wav", "mp3", "ogg", "m4a"] },
      ],
    });
    if (!canceled && filePaths[0]) await updateSound("file", filePaths[0]);
  };

  const previewSound = async () => {
    if (soundMode === "muted") return;
    const customSound = await globalThis.electron.getThemeSoundDataUrl(
      theme.id,
      variation
    );
    if (customSound === "") return;
    const soundUrl =
      customSound ??
      (await import("@renderer/assets/audio/achievement.wav")).default;
    const audio = new Audio(soundUrl);
    audio.volume = await getAchievementSoundVolume(
      getAchievementNotificationPreviewFlags(variation)
    );
    await audio.play();
  };

  const handleSoundModeChange = async (
    mode: AchievementNotificationSoundMode
  ) => {
    if (mode === "file") await chooseSound();
    else await updateSound(mode);
  };

  const colorControl = (
    label: string,
    property: AchievementNotificationCssProperty
  ) => (
    <div className="achievement-notification-customizer__field-with-reset">
      <TextField
        label={label}
        type="color"
        value={
          colorFallback.exec(effective[property])?.[0] ??
          colorFallback.exec(
            DEFAULT_ACHIEVEMENT_NOTIFICATION_CSS[property]
          )?.[0] ??
          "#000000"
        }
        onChange={(event) => updateProperty(property, event.target.value)}
      />
      <Button
        theme="outline"
        disabled={overrides[property] === undefined}
        onClick={() => updateProperty(property)}
        aria-label={t("use_default")}
        title={t("use_default")}
      >
        <UndoIcon />
      </Button>
    </div>
  );

  const testNotification = () => {
    const position = positions.includes(
      effective.position as AchievementCustomNotificationPosition
    )
      ? (effective.position as AchievementCustomNotificationPosition)
      : undefined;

    globalThis.electron
      .showAchievementTestNotification(variation, position)
      .catch(console.error);
  };

  const toggleCustomizer = () => {
    setIsCustomizerOpen((isOpen) => !isOpen);
  };

  return (
    <div className="achievement-notification-customizer achievement-notification-customizer--embedded">
      {parsed.status === "invalid" && (
        <div className="achievement-notification-customizer__marker-error">
          {t("marker_error")}
        </div>
      )}

      <div className="achievement-notification-customizer__toggle-row">
        <Button
          theme="outline"
          className="achievement-notification-customizer__toggle"
          aria-expanded={isCustomizerOpen}
          onClick={toggleCustomizer}
        >
          <ChevronDownIcon
            className={
              isCustomizerOpen
                ? "achievement-notification-customizer__toggle-icon achievement-notification-customizer__toggle-icon--open"
                : "achievement-notification-customizer__toggle-icon"
            }
          />
          {t(isCustomizerOpen ? "hide_customizer" : "open_customizer")}
        </Button>
        <span>{t("customizer_hint")}</span>
      </div>

      {isCustomizerOpen && (
        <>
          <div className="achievement-notification-customizer__section">
            <div className="achievement-notification-customizer__section-heading">
              <h2>{t("variation")}</h2>
              <span>{t("variation_hint")}</span>
            </div>
            <div className="achievement-notification-customizer__tabs">
              {ACHIEVEMENT_NOTIFICATION_VARIATIONS.map((item) => (
                <Button
                  key={item}
                  theme={variation === item ? "primary" : "outline"}
                  onClick={() => onVariationChange(item)}
                >
                  {settingsT(item)}
                </Button>
              ))}
            </div>
            <Button
              theme="outline"
              className="achievement-notification-customizer__test-button"
              onClick={testNotification}
            >
              <BellIcon />
              {settingsT("test_notification")}
            </Button>
          </div>

          <div className="achievement-notification-customizer__content">
            <div className="achievement-notification-customizer__controls">
              <div className="achievement-notification-customizer__section">
                <div className="achievement-notification-customizer__section-heading">
                  <h2>{t("display")}</h2>
                  <span>{t("display_hint")}</span>
                </div>
                <div className="achievement-notification-customizer__field-with-reset">
                  <SelectField
                    label={t("position")}
                    value={effective.position}
                    options={positions.map((position) => ({
                      key: position,
                      value: position,
                      label: settingsT(position),
                    }))}
                    onChange={(event) =>
                      updateProperty("position", event.target.value)
                    }
                  />
                  <Button
                    theme="outline"
                    disabled={overrides.position === undefined}
                    onClick={() => updateProperty("position")}
                    aria-label={t("use_default")}
                    title={t("use_default")}
                  >
                    <UndoIcon />
                  </Button>
                </div>
                <RangeControl
                  label={t("scale")}
                  property="scale"
                  value={effective.scale}
                  min={0.6}
                  max={2}
                  step={0.05}
                  suffix="%"
                  hasOverride={overrides.scale !== undefined}
                  onChange={updateProperty}
                  onReset={updateProperty}
                  resetLabel={t("use_default")}
                />
              </div>

              <div className="achievement-notification-customizer__section">
                <div className="achievement-notification-customizer__section-heading">
                  <h2>{t("colors_and_type")}</h2>
                  <span>{t("colors_and_type_hint")}</span>
                </div>
                <div className="achievement-notification-customizer__grid">
                  {colorControl(t("background_color"), "background")}
                  {colorControl(t("accent"), "accentColor")}
                  {colorControl(t("title_color"), "titleColor")}
                  {colorControl(t("description_color"), "descriptionColor")}
                </div>
              </div>

              <div className="achievement-notification-customizer__section">
                <div className="achievement-notification-customizer__section-heading">
                  <h2>{t("shape")}</h2>
                  <span>{t("shape_hint")}</span>
                </div>
                <div className="achievement-notification-customizer__sliders">
                  <RangeControl
                    label={t("radius")}
                    property="radius"
                    value={effective.radius}
                    min={0}
                    max={40}
                    step={1}
                    suffix="px"
                    hasOverride={overrides.radius !== undefined}
                    onChange={updateProperty}
                    onReset={updateProperty}
                    resetLabel={t("use_default")}
                  />
                  <RangeControl
                    label={t("outline")}
                    property="outlineWidth"
                    value={effective.outlineWidth}
                    min={0}
                    max={8}
                    step={1}
                    suffix="px"
                    hasOverride={overrides.outlineWidth !== undefined}
                    onChange={updateProperty}
                    onReset={updateProperty}
                    resetLabel={t("use_default")}
                  />
                  <RangeControl
                    label={t("shadow")}
                    property="shadowIntensity"
                    value={effective.shadowIntensity}
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    hasOverride={overrides.shadowIntensity !== undefined}
                    onChange={updateProperty}
                    onReset={updateProperty}
                    resetLabel={t("use_default")}
                  />
                </div>
                <div className="achievement-notification-customizer__grid">
                  {colorControl(t("outline_color"), "outlineColor")}
                  {colorControl(t("shadow_color"), "shadowColor")}
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
                    value={soundMode}
                    options={[
                      ...(variation === "default"
                        ? [
                            {
                              key: "default",
                              value: "default",
                              label: t("sound_default"),
                            },
                          ]
                        : [
                            {
                              key: "inherit",
                              value: "inherit",
                              label: t("sound_inherit"),
                            },
                          ]),
                      { key: "file", value: "file", label: t("sound_file") },
                      { key: "muted", value: "muted", label: t("sound_muted") },
                    ]}
                    onChange={(event) =>
                      handleSoundModeChange(
                        event.target.value as AchievementNotificationSoundMode
                      )
                    }
                  />
                  <label className="achievement-notification-customizer__range">
                    <span>{t("sound_volume")}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={soundVolume}
                      disabled={
                        soundMode === "muted" || soundMode === "inherit"
                      }
                      onChange={(event) =>
                        updateSoundVolume(Number(event.target.value))
                      }
                    />
                    <span>{soundVolume}%</span>
                  </label>
                  <div className="achievement-notification-customizer__actions">
                    <Button theme="outline" onClick={chooseSound}>
                      <UploadIcon /> {t("choose_file")}
                    </Button>
                    <Button
                      theme="outline"
                      disabled={soundMode === "muted"}
                      onClick={previewSound}
                    >
                      <PlayIcon /> {t("preview_sound")}
                    </Button>
                  </div>
                  {sound?.originalPath && (
                    <span className="achievement-notification-customizer__file-path">
                      {sound.originalPath}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
