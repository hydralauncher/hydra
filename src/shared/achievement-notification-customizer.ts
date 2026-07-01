import type {
  AchievementNotificationCustomizer,
  AchievementNotificationInfo,
  AchievementNotificationVariation,
  AchievementNotificationVariationSound,
  AchievementNotificationVariationStyle,
  Theme,
  UserPreferences,
} from "@types";

export const ACHIEVEMENT_NOTIFICATION_VARIATIONS = [
  "main",
  "rare",
  "platinum",
] as const satisfies AchievementNotificationVariation[];

export const ACHIEVEMENT_NOTIFICATION_PRESETS = [
  "hydra",
  "steam-deck",
  "xbox",
  "playstation",
  "windows",
] as const;

export const DEFAULT_ACHIEVEMENT_NOTIFICATION_SOUND_VOLUME = 1;

const baseVariationStyle: AchievementNotificationVariationStyle = {
  preset: "hydra",
  position: "top-left",
  width: 360,
  height: 140,
  scale: 1,
  displayTime: 4000,
  opacity: 1,
  background: "#1c1c1c",
  titleColor: "#c0c1c7",
  descriptionColor: "#dadbe1",
  accentColor: "#c0c1c7",
  fontFamily: "Noto Sans",
  iconSize: 64,
  radius: 0,
  outlineWidth: 1,
  outlineColor: "#ffffff1a",
  shadowColor: "#000000",
  shadowIntensity: 35,
};

export const DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER: AchievementNotificationCustomizer =
  {
    version: 1,
    variations: {
      main: baseVariationStyle,
      rare: {
        ...baseVariationStyle,
        accentColor: "#f4a510",
        outlineColor: "#f4a510",
        shadowColor: "#f4a510",
        shadowIntensity: 55,
      },
      platinum: {
        ...baseVariationStyle,
        background: "linear-gradient(94deg, #1c1c1c -25%, #044838 100%)",
        accentColor: "#0cf1ca",
        outlineColor: "#0cf1ca",
        shadowColor: "#0cf1ca",
        shadowIntensity: 60,
      },
    },
    sounds: {
      main: {
        mode: "default",
        volume: DEFAULT_ACHIEVEMENT_NOTIFICATION_SOUND_VOLUME,
      },
      rare: {
        mode: "default",
        volume: DEFAULT_ACHIEVEMENT_NOTIFICATION_SOUND_VOLUME,
      },
      platinum: {
        mode: "default",
        volume: DEFAULT_ACHIEVEMENT_NOTIFICATION_SOUND_VOLUME,
      },
    },
  };

export const getAchievementNotificationVariation = (
  achievement: Pick<
    AchievementNotificationInfo,
    "isRare" | "isPlatinum" | "isHidden"
  >
): AchievementNotificationVariation => {
  if (achievement.isPlatinum) return "platinum";
  if (achievement.isRare) return "rare";
  return "main";
};

export const isAchievementNotificationCustomizerEnabled = (
  userPreferences?: Pick<
    UserPreferences,
    "achievementNotificationsEnabled" | "achievementCustomNotificationsEnabled"
  > | null
) => {
  return (
    userPreferences?.achievementNotificationsEnabled !== false &&
    userPreferences?.achievementCustomNotificationsEnabled !== false
  );
};

const mergeVariationStyle = (
  variation: AchievementNotificationVariation,
  style?: Partial<AchievementNotificationVariationStyle>
): AchievementNotificationVariationStyle => {
  const fallback =
    DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.variations[variation];

  return {
    ...fallback,
    ...style,
    shadowColor:
      style?.shadowColor ?? style?.accentColor ?? fallback.shadowColor,
    shadowIntensity: style?.shadowIntensity ?? fallback.shadowIntensity,
  };
};

const getShadowFromIntensity = (
  intensity: number,
  shadowColor: string
): string => {
  const normalizedIntensity = Math.min(Math.max(intensity, 0), 100);

  if (normalizedIntensity === 0) {
    return "none";
  }

  const blur = Math.round(8 + normalizedIntensity * 0.28);
  const spread = Math.round(normalizedIntensity * 0.03);
  const alpha = Math.min(0.18 + normalizedIntensity / 220, 0.62);

  return `0 4px ${blur}px ${spread}px color-mix(in srgb, ${shadowColor} ${Math.round(
    normalizedIntensity * 0.45
  )}%, rgba(0, 0, 0, ${alpha}))`;
};

export const getThemeAchievementNotificationCustomizer = (
  theme?: Pick<Theme, "achievementNotificationCustomizer"> | null
): AchievementNotificationCustomizer => {
  const customizer = theme?.achievementNotificationCustomizer;

  return {
    version: 1,
    variations: {
      main: mergeVariationStyle("main", customizer?.variations?.main),
      rare: mergeVariationStyle("rare", customizer?.variations?.rare),
      platinum: mergeVariationStyle(
        "platinum",
        customizer?.variations?.platinum
      ),
    },
    sounds: {
      ...DEFAULT_ACHIEVEMENT_NOTIFICATION_CUSTOMIZER.sounds,
      ...customizer?.sounds,
    },
  };
};

export const getAchievementNotificationStyle = (
  customizer: AchievementNotificationCustomizer,
  variation: AchievementNotificationVariation
): AchievementNotificationVariationStyle => {
  return mergeVariationStyle(variation, customizer.variations[variation]);
};

export const getAchievementNotificationSound = (
  customizer: AchievementNotificationCustomizer,
  variation: AchievementNotificationVariation
): AchievementNotificationVariationSound => {
  return {
    mode: "default",
    volume: DEFAULT_ACHIEVEMENT_NOTIFICATION_SOUND_VOLUME,
    ...customizer.sounds?.[variation],
  };
};

export const getEffectiveAchievementNotificationSoundVolume = (
  masterVolume: number,
  customVolume: number | undefined
) => {
  const normalizedMasterVolume = Math.min(Math.max(masterVolume, 0), 1);
  const normalizedCustomVolume = Math.min(
    Math.max(customVolume ?? DEFAULT_ACHIEVEMENT_NOTIFICATION_SOUND_VOLUME, 0),
    1
  );

  return Math.min(normalizedMasterVolume, normalizedCustomVolume);
};

export const getAchievementNotificationPosition = (
  customizer: AchievementNotificationCustomizer,
  variation: AchievementNotificationVariation,
  fallback: AchievementNotificationVariationStyle["position"] = "top-left"
) => {
  return (
    getAchievementNotificationStyle(customizer, variation).position ?? fallback
  );
};

export const getAchievementNotificationCssVariables = (
  style: AchievementNotificationVariationStyle
): Record<string, string> => {
  return {
    "--achievement-notification-width": `${style.width}px`,
    "--achievement-notification-height": `${style.height}px`,
    "--achievement-notification-scaled-width": `${Math.ceil(
      style.width * style.scale
    )}px`,
    "--achievement-notification-scaled-height": `${Math.ceil(
      style.height * style.scale
    )}px`,
    "--achievement-notification-scale": `${style.scale}`,
    "--achievement-notification-opacity": `${style.opacity}`,
    "--achievement-notification-background": style.background,
    "--achievement-notification-title-color": style.titleColor,
    "--achievement-notification-description-color": style.descriptionColor,
    "--achievement-notification-accent-color": style.accentColor,
    "--achievement-notification-font-family": style.fontFamily,
    "--achievement-notification-icon-size": `${style.iconSize}px`,
    "--achievement-notification-radius": `${style.radius}px`,
    "--achievement-notification-outline-width": `${style.outlineWidth}px`,
    "--achievement-notification-outline-color": style.outlineColor,
    "--achievement-notification-shadow": getShadowFromIntensity(
      style.shadowIntensity,
      style.shadowColor
    ),
  };
};

export const getAchievementNotificationWindowSize = (
  theme?: Pick<Theme, "achievementNotificationCustomizer"> | null
) => {
  const customizer = getThemeAchievementNotificationCustomizer(theme);
  const sizes = ACHIEVEMENT_NOTIFICATION_VARIATIONS.map((variation) => {
    const style = getAchievementNotificationStyle(customizer, variation);
    return {
      width: Math.ceil(style.width * style.scale),
      height: Math.ceil(style.height * style.scale),
    };
  });

  return {
    width: Math.max(...sizes.map((size) => size.width)),
    height: Math.max(...sizes.map((size) => size.height)),
  };
};

export const getAchievementNotificationWindowPosition = (
  position: AchievementNotificationVariationStyle["position"],
  display: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number }
) => {
  const resolvedPosition = position ?? "top-left";

  if (resolvedPosition === "bottom-left") {
    return {
      x: display.x,
      y: display.y + display.height - size.height,
    };
  }

  if (resolvedPosition === "bottom-center") {
    return {
      x: display.x + (display.width - size.width) / 2,
      y: display.y + display.height - size.height,
    };
  }

  if (resolvedPosition === "bottom-right") {
    return {
      x: display.x + display.width - size.width,
      y: display.y + display.height - size.height,
    };
  }

  if (resolvedPosition === "top-center") {
    return {
      x: display.x + (display.width - size.width) / 2,
      y: display.y,
    };
  }

  if (resolvedPosition === "top-right") {
    return {
      x: display.x + display.width - size.width,
      y: display.y,
    };
  }

  return {
    x: display.x,
    y: display.y,
  };
};

export const getVariationSoundFileName = (
  variation: AchievementNotificationVariation,
  extension: string
) => {
  return `achievement-${variation}${extension}`;
};
