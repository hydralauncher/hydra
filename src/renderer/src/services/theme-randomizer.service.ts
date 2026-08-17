export interface RandomTheme {
  name: string;
  primaryHue: number;
  accentHue: number;
  saturation: number;
  borderRadius: number;
  backgroundEffect: string;
  backgroundConfig: Record<string, unknown>;
  fontFamily: string;
  glassOpacity: number;
  cardBlur: number;
}

const FONTS = [
  "Poppins",
  "Inter",
  "Outfit",
  "Raleway",
  "Nunito",
  "DM Sans",
  "Space Grotesk",
  "Syne",
];

const BG_EFFECTS = [
  "floatinglines",
  "particles",
  "lightrays",
  "colorbends",
  "beams",
  "pixelblast",
  "lightpillar",
];

const BORDER_RADIUS_PRESETS = [4, 8, 12, 16, 20, 24];

function rand(min: number, max: number, step = 1): number {
  const steps = Math.floor((max - min) / step);
  return min + Math.floor(Math.random() * (steps + 1)) * step;
}

function generateBackgroundConfig(
  effect: string,
  ph: number,
  ah: number,
  s: number
): Record<string, unknown> {
  const c1 = hslToHex(ph, s, 55);
  const c2 = hslToHex(ah, s, 60);
  const c3 = hslToHex((ph + 180) % 360, s, 50);

  switch (effect) {
    case "floatinglines":
      return {
        linesGradient: [c1, c2],
        lineCount: rand(3, 8),
        lineDistance: rand(3, 8),
        bendRadius: rand(3, 8),
        bendStrength: -(Math.random() * 1.5),
        interactive: true,
        parallax: true,
      };
    case "particles":
      return {
        particleColors: [c1],
        particleCount: rand(100, 350, 50),
        particleSpread: rand(5, 15),
        speed: parseFloat((Math.random() * 0.3).toFixed(2)),
        particleBaseSize: rand(1, 3),
        moveParticlesOnHover: true,
        alphaParticles: Math.random() > 0.5,
        disableRotation: false,
      };
    case "lightrays": {
      const origins = ["top-left", "top-center", "top-right", "center"];
      return {
        raysOrigin: origins[Math.floor(Math.random() * origins.length)],
        raysColor: c1,
        raysSpeed: parseFloat((Math.random() * 2).toFixed(2)),
        lightSpread: parseFloat((Math.random() * 0.8 + 0.2).toFixed(2)),
        rayLength: rand(2, 5),
        followMouse: true,
        mouseInfluence: parseFloat((Math.random() * 0.3).toFixed(2)),
        noiseAmount: 0,
        pulsating: false,
        fadeDistance: 1,
        saturation: 1,
      };
    }
    case "colorbends":
      return {
        colors: [c1, c2, c3],
        rotation: rand(0, 360, 15),
        speed: parseFloat((Math.random() * 0.5).toFixed(2)),
        scale: parseFloat((Math.random() * 0.5 + 0.8).toFixed(2)),
        frequency: parseFloat((Math.random() + 0.5).toFixed(2)),
        warpStrength: parseFloat((Math.random() * 1.5 + 0.3).toFixed(2)),
        mouseInfluence: 1,
        parallax: 0.5,
        noise: 0.1,
        transparent: true,
        autoRotate: Math.random() > 0.5 ? rand(0, 30) : 0,
      };
    case "beams":
      return {
        beamWidth: rand(2, 5),
        beamHeight: rand(20, 50, 5),
        beamNumber: rand(10, 30, 5),
        lightColor: c1,
        speed: parseFloat((Math.random() * 3 + 1).toFixed(2)),
        noiseIntensity: parseFloat((Math.random() * 2 + 0.5).toFixed(2)),
        scale: parseFloat((Math.random() * 0.3 + 0.1).toFixed(2)),
        rotation: rand(15, 60, 5),
      };
    case "pixelblast":
      return {
        color: c1,
        pixelSize: rand(2, 5),
        patternScale: parseFloat((Math.random() * 4 + 2).toFixed(1)),
        patternDensity: parseFloat((Math.random() * 1.5 + 0.8).toFixed(2)),
        rippleSpeed: parseFloat((Math.random() * 0.5 + 0.1).toFixed(2)),
        rippleThickness: 0.07,
        rippleIntensityScale: 1.2,
        speed: parseFloat((Math.random() * 0.6 + 0.2).toFixed(2)),
        transparent: true,
        edgeFade: parseFloat((Math.random() * 0.5 + 0.2).toFixed(2)),
        enableRipples: true,
        variant: Math.random() > 0.5 ? "square" : "circle",
      };
    case "lightpillar":
      return {
        topColor: c1,
        bottomColor: c2,
        intensity: parseFloat((Math.random() * 0.8 + 0.5).toFixed(2)),
        rotationSpeed: parseFloat((Math.random() * 0.5 + 0.1).toFixed(2)),
        glowAmount: 0.002,
        pillarWidth: rand(2, 5),
        pillarHeight: parseFloat((Math.random() * 0.4 + 0.2).toFixed(2)),
        noiseIntensity: parseFloat((Math.random() * 0.8 + 0.2).toFixed(2)),
        pillarRotation: rand(10, 45, 5),
        interactive: false,
      };
    default:
      return {};
  }
}

function hslToHex(h: number, s: number, l: number): string {
  const sl = s / 100;
  const ll = l / 100;
  const a = sl * Math.min(ll, 1 - ll);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const color = ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const THEME_NAMES = [
  "Aurora Boreal",
  "Neon Midnight",
  "Cyber Dusk",
  "Violet Storm",
  "Ocean Pulse",
  "Solar Flare",
  "Deep Space",
  "Emerald Mist",
  "Crimson Dawn",
  "Pixel Drift",
  "Neon Haze",
  "Obsidian Wave",
];

export function generateRandomTheme(): RandomTheme {
  const primaryHue = rand(0, 360, 15);
  const accentHue = (primaryHue + rand(90, 210, 30)) % 360;
  const saturation = rand(55, 90, 5);
  const borderRadius =
    BORDER_RADIUS_PRESETS[
      Math.floor(Math.random() * BORDER_RADIUS_PRESETS.length)
    ];
  const effect = BG_EFFECTS[Math.floor(Math.random() * BG_EFFECTS.length)];
  const font = FONTS[Math.floor(Math.random() * FONTS.length)];

  return {
    name: THEME_NAMES[Math.floor(Math.random() * THEME_NAMES.length)],
    primaryHue,
    accentHue,
    saturation,
    borderRadius,
    backgroundEffect: effect,
    backgroundConfig: generateBackgroundConfig(
      effect,
      primaryHue,
      accentHue,
      saturation
    ),
    fontFamily: font,
    glassOpacity: parseFloat((Math.random() * 0.08 + 0.04).toFixed(3)),
    cardBlur: rand(8, 20, 4),
  };
}

const CSS_VAR_PREFIX = "hydra-rnd";
const LOCAL_STORAGE_KEY = "hydra_random_theme";
const SAVED_KEY = "hydra_saved_random_theme";
const ORIGINAL_STATE_KEY = "hydra_original_state";
const STYLE_TAG_ID = "hydra-rnd-overrides";

function buildRadiusStyleSheet(r: number): string {
  const half = Math.max(2, Math.round(r * 0.5));
  const full = `${r}px`;
  const halfPx = `${half}px`;
  return `
    /* hydra-rnd: border-radius overrides */
    button, [class*="__btn"], [class*="-button"], [class*="-tab"] { border-radius: ${halfPx} !important; }
    input, textarea, select, [class*="__input"], [class*="__field"], [class*="__path"] { border-radius: ${halfPx} !important; }
    [class*="__card"], [class*="-card"] { border-radius: ${full} !important; }
    [class*="__modal"], [class*="-modal"] > div, .modal__content { border-radius: ${full} !important; }
    [class*="__tag"], [class*="-badge"], [class*="-chip"] { border-radius: 999px !important; }
    [class*="__panel"], [class*="-panel"], [class*="__box"] { border-radius: ${full} !important; }
    [class*="__dropdown"], [class*="-dropdown"], [class*="__menu"] { border-radius: ${full} !important; }
    [class*="__toast"], [class*="-toast"] { border-radius: ${full} !important; }
    [class*="__hero"], [class*="-hero"], [class*="__banner"] { border-radius: ${full} !important; }
    ::-webkit-scrollbar-thumb { border-radius: 999px !important; }
  `;
}

function injectStyleTag(css: string): void {
  let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = STYLE_TAG_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = css;
}

function removeStyleTag(): void {
  document.getElementById(STYLE_TAG_ID)?.remove();
}

function saveOriginalState(): void {
  if (localStorage.getItem(ORIGINAL_STATE_KEY)) return;
  const original = {
    effect: localStorage.getItem("hydra_background_effect") ?? "floatinglines",
    config: localStorage.getItem("hydra_background_config") ?? "{}",
    font: document.body.style.getPropertyValue("--app-font") || "",
  };
  localStorage.setItem(ORIGINAL_STATE_KEY, JSON.stringify(original));
}

export function applyRandomTheme(theme: RandomTheme): void {
  saveOriginalState();

  const root = document.documentElement;
  const { primaryHue: ph, accentHue: ah, saturation: s } = theme;

  root.style.setProperty(`--${CSS_VAR_PREFIX}-primary`, hslToHex(ph, s, 55));
  root.style.setProperty(
    `--${CSS_VAR_PREFIX}-primary-dim`,
    hslToHex(ph, s - 10, 35)
  );
  root.style.setProperty(`--${CSS_VAR_PREFIX}-accent`, hslToHex(ah, s, 60));
  root.style.setProperty(
    `--${CSS_VAR_PREFIX}-accent-dim`,
    hslToHex(ah, s - 10, 30)
  );
  root.style.setProperty(
    `--${CSS_VAR_PREFIX}-radius`,
    `${theme.borderRadius}px`
  );
  root.style.setProperty(`--${CSS_VAR_PREFIX}-glass`, `${theme.glassOpacity}`);
  root.style.setProperty(`--${CSS_VAR_PREFIX}-blur`, `${theme.cardBlur}px`);
  root.style.setProperty(`--${CSS_VAR_PREFIX}-font`, theme.fontFamily);

  document.body.style.setProperty("--app-font", theme.fontFamily);

  injectStyleTag(buildRadiusStyleSheet(theme.borderRadius));

  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(theme));
  localStorage.setItem("hydra_background_effect", theme.backgroundEffect);
  localStorage.setItem(
    "hydra_background_config",
    JSON.stringify(theme.backgroundConfig)
  );
  window.dispatchEvent(new Event("background_effect_update"));
}

export function clearRandomTheme(): void {
  const root = document.documentElement;
  const vars = [
    "primary",
    "primary-dim",
    "accent",
    "accent-dim",
    "radius",
    "glass",
    "blur",
    "font",
  ];
  vars.forEach((v) => root.style.removeProperty(`--${CSS_VAR_PREFIX}-${v}`));
  document.body.style.removeProperty("--app-font");

  removeStyleTag();
  localStorage.removeItem(LOCAL_STORAGE_KEY);

  try {
    const raw = localStorage.getItem(ORIGINAL_STATE_KEY);
    if (raw) {
      const original = JSON.parse(raw) as {
        effect: string;
        config: string;
        font: string;
      };
      localStorage.setItem("hydra_background_effect", original.effect);
      localStorage.setItem("hydra_background_config", original.config);
      if (original.font) {
        document.body.style.setProperty("--app-font", original.font);
      } else {
        document.body.style.removeProperty("--app-font");
      }
      window.dispatchEvent(new Event("background_effect_update"));
    }
  } finally {
    localStorage.removeItem(ORIGINAL_STATE_KEY);
  }
}

export function saveRandomTheme(theme: RandomTheme): void {
  const saved = getSavedThemes();
  const updated = [{ ...theme, savedAt: Date.now() }, ...saved].slice(0, 10);
  localStorage.setItem(SAVED_KEY, JSON.stringify(updated));
}

export function getSavedThemes(): (RandomTheme & { savedAt: number })[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function deleteSavedTheme(index: number): void {
  const saved = getSavedThemes();
  saved.splice(index, 1);
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
}

export function getActiveRandomTheme(): RandomTheme | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function restoreRandomThemeOnBoot(): void {
  const theme = getActiveRandomTheme();
  if (theme) applyRandomTheme(theme);
}
