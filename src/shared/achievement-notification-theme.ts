import type {
  AchievementCustomNotificationPosition,
  AchievementNotificationInfo,
  AchievementNotificationVariation,
} from "@types";

export const ACHIEVEMENT_NOTIFICATION_VARIATIONS = [
  "default",
  "rare",
  "hidden",
  "platinum",
] as const satisfies AchievementNotificationVariation[];

export const ACHIEVEMENT_CUSTOMIZER_START =
  "/* HYDRA ACHIEVEMENT CUSTOMIZER START */";
export const ACHIEVEMENT_CUSTOMIZER_END =
  "/* HYDRA ACHIEVEMENT CUSTOMIZER END */";

export type AchievementNotificationCssProperty =
  | "position"
  | "scale"
  | "background"
  | "titleColor"
  | "descriptionColor"
  | "accentColor"
  | "radius"
  | "outlineWidth"
  | "outlineColor"
  | "shadowColor"
  | "shadowIntensity";

export type AchievementNotificationCssOverrides = Partial<
  Record<AchievementNotificationCssProperty, string>
>;

export type AchievementNotificationManagedCss = Record<
  AchievementNotificationVariation,
  AchievementNotificationCssOverrides
>;

export type ManagedAchievementCssParseResult =
  | { status: "absent"; variations: AchievementNotificationManagedCss }
  | { status: "valid"; variations: AchievementNotificationManagedCss }
  | { status: "invalid"; variations: AchievementNotificationManagedCss };

export const DEFAULT_ACHIEVEMENT_NOTIFICATION_CSS: Record<
  AchievementNotificationCssProperty,
  string
> = {
  position: "top-left",
  scale: "1",
  background: "#1c1c1c",
  titleColor: "#c0c1c7",
  descriptionColor: "#dadbe1",
  accentColor: "#c0c1c7",
  radius: "0",
  outlineWidth: "1",
  outlineColor: "#ffffff1a",
  shadowColor: "#000000",
  shadowIntensity: "35",
};

const DEFAULT_VARIATION_CSS: Partial<
  Record<AchievementNotificationVariation, AchievementNotificationCssOverrides>
> = {
  rare: { accentColor: "#f4a510" },
  platinum: {
    background: "linear-gradient(94deg, #1c1c1c -25%, #044838 100%)",
    accentColor: "#0cf1ca",
  },
};

const SELECTORS: Record<AchievementNotificationVariation, string> = {
  default: ".achievement-notification",
  rare: ".achievement-notification--rare",
  hidden: ".achievement-notification--hidden",
  platinum: ".achievement-notification--platinum",
};

const CSS_VARIABLES: Record<AchievementNotificationCssProperty, string> = {
  position: "--achievement-notification-position",
  scale: "--achievement-notification-scale",
  background: "--achievement-notification-background",
  titleColor: "--achievement-notification-title-color",
  descriptionColor: "--achievement-notification-description-color",
  accentColor: "--achievement-notification-accent-color",
  radius: "--achievement-notification-radius",
  outlineWidth: "--achievement-notification-outline-width",
  outlineColor: "--achievement-notification-outline-color",
  shadowColor: "--achievement-notification-shadow-color",
  shadowIntensity: "--achievement-notification-shadow-intensity",
};

const CSS_PROPERTIES = Object.keys(
  CSS_VARIABLES
) as AchievementNotificationCssProperty[];

const emptyManagedCss = (): AchievementNotificationManagedCss => ({
  default: {},
  rare: {},
  hidden: {},
  platinum: {},
});

const escapeRegex = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

export const parseAchievementNotificationManagedCss = (
  css: string
): ManagedAchievementCssParseResult => {
  const variations = emptyManagedCss();
  const startCount = css.split(ACHIEVEMENT_CUSTOMIZER_START).length - 1;
  const endCount = css.split(ACHIEVEMENT_CUSTOMIZER_END).length - 1;

  if (startCount === 0 && endCount === 0) {
    return { status: "absent", variations };
  }

  if (startCount !== 1 || endCount !== 1) {
    return { status: "invalid", variations };
  }

  const start = css.indexOf(ACHIEVEMENT_CUSTOMIZER_START);
  const end = css.indexOf(ACHIEVEMENT_CUSTOMIZER_END);
  if (end < start) return { status: "invalid", variations };

  const block = css.slice(start + ACHIEVEMENT_CUSTOMIZER_START.length, end);
  const uncommentedBlock = block.replaceAll(/\/\*[\s\S]*?\*\//g, "");

  for (const variation of ACHIEVEMENT_NOTIFICATION_VARIATIONS) {
    const rule = new RegExp(
      String.raw`${escapeRegex(SELECTORS[variation])}\s*\{([^}]*)\}`,
      "m"
    ).exec(uncommentedBlock);
    if (!rule) continue;

    for (const property of CSS_PROPERTIES) {
      const declaration = new RegExp(
        String.raw`${escapeRegex(CSS_VARIABLES[property])}\s*:\s*([^;]+);?`,
        "m"
      ).exec(rule[1]);
      if (declaration) variations[variation][property] = declaration[1].trim();
    }
  }

  return { status: "valid", variations };
};

const renderManagedBlock = (variations: AchievementNotificationManagedCss) => {
  const rules = ACHIEVEMENT_NOTIFICATION_VARIATIONS.flatMap((variation) => {
    const declarations = CSS_PROPERTIES.flatMap((property) => {
      const value = variations[variation][property];
      return value === undefined
        ? []
        : [`  ${CSS_VARIABLES[property]}: ${value};`];
    });

    return declarations.length
      ? [`${SELECTORS[variation]} {\n${declarations.join("\n")}\n}`]
      : [];
  });

  return [
    ACHIEVEMENT_CUSTOMIZER_START,
    ...rules,
    ACHIEVEMENT_CUSTOMIZER_END,
  ].join("\n\n");
};

export const updateAchievementNotificationManagedCss = (
  css: string,
  variation: AchievementNotificationVariation,
  property: AchievementNotificationCssProperty,
  value?: string
) => {
  const parsed = parseAchievementNotificationManagedCss(css);
  if (parsed.status === "invalid") {
    throw new Error("Invalid achievement customizer markers");
  }

  const variations = {
    ...parsed.variations,
    [variation]: { ...parsed.variations[variation] },
  };

  if (value === undefined) delete variations[variation][property];
  else variations[variation][property] = value;

  const block = renderManagedBlock(variations);
  if (parsed.status === "absent") {
    return `${css.trimEnd()}${css.trim() ? "\n\n" : ""}${block}\n`;
  }

  const start = css.indexOf(ACHIEVEMENT_CUSTOMIZER_START);
  const end =
    css.indexOf(ACHIEVEMENT_CUSTOMIZER_END) + ACHIEVEMENT_CUSTOMIZER_END.length;
  return `${css.slice(0, start)}${block}${css.slice(end)}`;
};

export const getEffectiveAchievementNotificationCss = (
  variations: AchievementNotificationManagedCss,
  variation: AchievementNotificationVariation
) => ({
  ...DEFAULT_ACHIEVEMENT_NOTIFICATION_CSS,
  ...DEFAULT_VARIATION_CSS[variation],
  ...variations.default,
  ...(variation === "default" ? {} : variations[variation]),
});

export const getAchievementNotificationVariation = (
  achievement: Pick<
    AchievementNotificationInfo,
    "isRare" | "isPlatinum" | "isHidden"
  >
): AchievementNotificationVariation => {
  if (achievement.isPlatinum) return "platinum";
  if (achievement.isHidden) return "hidden";
  if (achievement.isRare) return "rare";
  return "default";
};

export const getAchievementNotificationPreviewFlags = (
  variation: AchievementNotificationVariation
) => ({
  isRare: variation === "rare",
  isHidden: variation === "hidden",
  isPlatinum: variation === "platinum",
});

export const getAchievementNotificationWindowPosition = (
  position: AchievementCustomNotificationPosition | undefined,
  display: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number }
) => {
  let horizontal = display.x;
  if (position?.endsWith("center")) {
    horizontal += (display.width - size.width) / 2;
  } else if (position?.endsWith("right")) {
    horizontal += display.width - size.width;
  }

  const vertical = position?.startsWith("bottom")
    ? display.y + display.height - size.height
    : display.y;

  return { x: horizontal, y: vertical };
};

export const getEffectiveAchievementNotificationSoundVolume = (
  masterVolume: number,
  variationVolume?: number
) =>
  Math.min(
    Math.max(masterVolume, 0),
    Math.min(Math.max(variationVolume ?? masterVolume, 0), 1)
  );
