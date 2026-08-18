export interface ElementStyle {
  borderRadius: number;
  borderWidth: number;
  borderColor: string;
  bgColor: string;
  bgOpacity: number;
  blur: number;
}

export interface CustomThemeConfig {
  global: { borderRadius: number; font: string; useGameBackground: boolean };
  buttons: ElementStyle;
  cards: ElementStyle;
  background: {
    type: "effect" | "media";
    mediaUrl: string;
    effectName?: string;
    effectConfig?: string;
  };
}

export const DEFAULT_CONFIG: CustomThemeConfig = {
  global: { borderRadius: 12, font: "Poppins", useGameBackground: true },
  buttons: {
    borderRadius: 100,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    bgColor: "#ffffff",
    bgOpacity: 0.05,
    blur: 16,
  },
  cards: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    bgColor: "#ffffff",
    bgOpacity: 0.04,
    blur: 0,
  },
  background: { type: "effect", mediaUrl: "" },
};

const STYLE_ID = "hydra-customizer";
const STORAGE_KEY = "hydra_custom_theme_active";
const SAVED_KEY = "hydra_custom_themes_saved";
const ORIGINAL_STATE_KEY = "hydra_customizer_original";

interface OriginalState {
  effect: string;
  effectConfig: string;
}

function saveOriginalStateOnce(): void {
  if (localStorage.getItem(ORIGINAL_STATE_KEY)) return;
  const state: OriginalState = {
    effect: localStorage.getItem("hydra_background_effect") ?? "floatinglines",
    effectConfig: localStorage.getItem("hydra_background_config") ?? "{}",
  };
  localStorage.setItem(ORIGINAL_STATE_KEY, JSON.stringify(state));
}

function hexToRgba(color: string, opacity: number): string {
  const m = color.match(/^#([0-9a-f]{6})/i);
  if (!m) return `rgba(255,255,255,${opacity})`;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

function rand(min: number, max: number, step = 1): number {
  const steps = Math.floor((max - min) / step);
  return min + Math.floor(Math.random() * (steps + 1)) * step;
}

function randomHex(): string {
  return `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0")}`;
}

const BG_IMAGE_ID = "hydra-bg-image";

const BG_ELEMENT_STYLE = [
  "position:fixed",
  "inset:0",
  "z-index:-2",
  "width:100%",
  "height:100%",
  "object-fit:cover",
  "pointer-events:none",
  "display:block",
].join(";");

function injectBgImage(src: string): void {
  document.getElementById(BG_IMAGE_ID)?.remove();
  const img = document.createElement("img");
  img.id = BG_IMAGE_ID;
  img.src = src;
  img.alt = "";
  img.style.cssText = BG_ELEMENT_STYLE;
  // Melhor qualidade de renderização no Chromium/Electron
  (
    img.style as CSSStyleDeclaration & { imageRendering: string }
  ).imageRendering = "high-quality";
  document.body.appendChild(img);
}

function removeBgMedia(): void {
  document.getElementById(BG_IMAGE_ID)?.remove();
}

export function generateRandomElementStyle(
  type: "button" | "card"
): ElementStyle {
  return {
    borderRadius: type === "button" ? rand(0, 100, 4) : rand(0, 24, 4),
    borderWidth: rand(0, 2),
    borderColor: `rgba(255,255,255,${parseFloat((Math.random() * 0.25).toFixed(2))})`,
    bgColor: randomHex(),
    bgOpacity: parseFloat((Math.random() * 0.18 + 0.02).toFixed(3)),
    blur: rand(0, 24, 4),
  };
}

function buildCSS(c: CustomThemeConfig): string {
  const { global: g, buttons: b, cards: ca } = c;
  const btnBg = hexToRgba(b.bgColor, b.bgOpacity);
  const cardBg = hexToRgba(ca.bgColor, ca.bgOpacity);
  const btnBlur = b.blur > 0 ? `blur(${b.blur}px)` : "none";
  const cardBlur = ca.blur > 0 ? `blur(${ca.blur}px)` : "none";
  const btnBorder = `${b.borderWidth}px solid ${b.borderColor}`;
  const cardBorder = `${ca.borderWidth}px solid ${ca.borderColor}`;
  // Container de tabs: buttonRadius + padding interno (4px), máx 100
  const tabBarRadius = Math.min(b.borderRadius + 4, 100);

  // Prefixo #root: specificity 1,1,0 → vence qualquer override de SCSS com .a .b (0,2,0)
  const r = "#root";

  // Bloco nav: header, sidebar, tabs — SEM overflow:hidden (evita cortar conteúdo)
  const np = `
    border-radius: ${b.borderRadius}px !important;
    border: ${btnBorder} !important;
    background: ${btnBg} !important;
    backdrop-filter: ${btnBlur} !important;
    -webkit-backdrop-filter: ${btnBlur} !important;`;

  // Bloco de menu flutuante (blur mínimo 12px para legibilidade, raio proporcional a cards/modais máx 14px)
  const menuRadius = Math.min(Math.max(ca.borderRadius, 6), 14);
  const mp = `
    border-radius: ${menuRadius}px !important;
    border: ${btnBorder} !important;
    background: ${btnBg} !important;
    backdrop-filter: blur(${Math.max(b.blur, 12)}px) !important;
    -webkit-backdrop-filter: blur(${Math.max(b.blur, 12)}px) !important;`;

  const useGameBg = g.useGameBackground ?? true;

  const gameBgCss = !useGameBg
    ? `${r} .home__background, ${r} .home__solid-background { display: none !important; }`
    : "";

  return `/* hydra-customizer */

  /* ── Tipografia ──────────────────────────────────────── */
  body { font-family: "${g.font}", sans-serif !important; }

  /* ── Modal ───────────────────────────────────────────── */
  ${r} .modal {
    background-color: rgba(0, 0, 0, 0.5) !important;
    backdrop-filter: blur(24px) !important;
    -webkit-backdrop-filter: blur(24px) !important;
  }

  /* ── Componente Button: shape para todos ────────────────── */
  ${r} .button {
    border-radius: ${b.borderRadius}px !important;
    overflow: hidden !important;
    isolation: isolate !important;
  }

  /* ── Componente Button: efeito completo só em não-outline ── */
  ${r} .button:not(.button--outline) {
    border: ${btnBorder} !important;
    background: ${btnBg} !important;
    backdrop-filter: ${btnBlur} !important;
    -webkit-backdrop-filter: ${btnBlur} !important;
  }

  /* ── Header: barra de busca ──────────────────────────── */
  ${r} .header__search-bar { ${np} }

  /* ── Header: botão voltar folder ─────────────────────── */
  ${r} .header__folder-back-button { ${np} }

  /* ── Header: tabs de navegação (sempre sem fundo/borda, apenas texto e linha) ── */
  ${r} .header__nav-item,
  ${r} .header__nav-item--active {
    border-radius: 0 !important;
    border: none !important;
    background: transparent !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    box-shadow: none !important;
  }

  /* ── Sidebar ajustes: inativa → só shape ───────────────── */
  ${r} .settings__sidebar-button {
    border-radius: ${b.borderRadius}px !important;
    border: none !important;
    background: transparent !important;
  }
  /* Sidebar ajustes: ATIVA → efeito completo ─────────────── */
  ${r} .settings__sidebar-button--active { ${np} }

  /* ── Sidebar principal: nav links ──────────────────────── */
  ${r} .sidebar__nav-link,
  ${r} .sidebar__nav-button,
  ${r} .sidebar-profile__button { ${np} }

  /* ── Tab bars (container com padding) ────────────────── */
  ${r} .appearance-tabs__bar,
  ${r} .downloads-tabs__bar,
  ${r} .cz__bg-toggle {
    border-radius: ${tabBarRadius}px !important;
    border: ${btnBorder} !important;
    background: ${btnBg} !important;
    backdrop-filter: ${btnBlur} !important;
    -webkit-backdrop-filter: ${btnBlur} !important;
    overflow: hidden !important;
  }

  /* ── Tab pills: inativa → só shape ─────────────────────── */
  ${r} .appearance-tabs__tab,
  ${r} .downloads-tabs__tab,
  ${r} .cz__bg-tab {
    border-radius: ${b.borderRadius}px !important;
    border: none !important;
    background: transparent !important;
  }
  /* Tab pills: ATIVA → efeito completo ────────────────────── */
  ${r} .appearance-tabs__tab--active,
  ${r} .downloads-tabs__tab--active,
  ${r} .cz__bg-tab--active { ${np} }

  /* ── Inputs: container visual (não o <input> interno) ── */
  ${r} .text-field-container__text-field,
  ${r} .select-field {
    border-radius: ${Math.min(b.borderRadius, 12)}px !important;
    border: ${btnBorder} !important;
    backdrop-filter: ${btnBlur} !important;
    -webkit-backdrop-filter: ${btnBlur} !important;
    overflow: hidden !important;
    isolation: isolate !important;
  }

  /* ── Menus flutuantes ────────────────────────────────── */
  ${r} .context-menu,
  ${r} .context-menu__submenu,
  ${r} .dropdown-menu__content,
  ${r} .select-field__dropdown,
  ${r} .library-filter-options__dropdown,
  ${r} .profile-sort-options__dropdown,
  ${r} .filter-dropdown__menu { ${mp} }

  /* ── Cards de conteúdo (sem imagem de fundo) ─────────── */
  ${r} .theme-card,
  ${r} .ds-card,
  ${r} .library__folder-card {
    border-radius: ${ca.borderRadius}px !important;
    border: ${cardBorder} !important;
    background: ${cardBg} !important;
    backdrop-filter: ${cardBlur} !important;
    -webkit-backdrop-filter: ${cardBlur} !important;
  }

  /* ── Home folder cards: inativos → só shape ────────────── */
  ${r} .home__folder-card {
    border-radius: ${ca.borderRadius}px !important;
    border: ${cardBorder} !important;
    background: transparent !important;
    backdrop-filter: none !important;
  }
  /* Home folder card: SELECIONADO → efeito completo ───────── */
  ${r} .home__card--selected.home__folder-card {
    border-radius: ${ca.borderRadius}px !important;
    border: ${cardBorder} !important;
    background: ${cardBg} !important;
    backdrop-filter: ${cardBlur} !important;
    -webkit-backdrop-filter: ${cardBlur} !important;
  }

  /* ── Cards de imagem (só forma, bg preserva a capa) ──── */
  ${r} .game-card,
  ${r} .home__card,
  ${r} .lib-cat-card,
  ${r} .home__folder-game-card-btn,
  ${r} .home__folder-game-card,
  ${r} .home__folder-view-btn,
  ${r} .library-game-card__wrapper,
  ${r} .library-game-card-large {
    border-radius: ${ca.borderRadius}px !important;
    border: ${cardBorder} !important;
  }

  /* ── Biblioteca: botão de filtro (Installed first) ───── */
  ${r} .library-filter-options__trigger { ${np} }

  /* ── Biblioteca: dropdown de filtro ─────────────────── */
  ${r} .library-filter-options__dropdown { ${mp} }

  /* ── Biblioteca: botões de ação (+, upload, heart) ───── */
  ${r} .library__favorites-btn { ${np} }

  /* ── Biblioteca: view options container ──────────────── */
  ${r} .library-view-options__options {
    border-radius: ${b.borderRadius + 4}px !important;
    border: ${btnBorder} !important;
    background: ${btnBg} !important;
    backdrop-filter: ${btnBlur} !important;
    -webkit-backdrop-filter: ${btnBlur} !important;
    overflow: hidden !important;
  }

  /* ── Biblioteca: botão de view inativo → sem fill ────── */
  ${r} .library-view-options__option {
    border-radius: ${b.borderRadius}px !important;
    background: transparent !important;
  }

  /* ── Biblioteca: botão de view ATIVO → efeito completo ─ */
  ${r} .library-view-options__option.active {
    background: ${btnBg} !important;
    backdrop-filter: ${btnBlur} !important;
    -webkit-backdrop-filter: ${btnBlur} !important;
  }

  ${gameBgCss}`;
}

function inject(css: string): void {
  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = css;
}

export function applyCustomTheme(config: CustomThemeConfig): void {
  saveOriginalStateOnce();

  if (config.background.type === "effect") {
    removeBgMedia();
    if (config.background.effectName) {
      localStorage.setItem(
        "hydra_background_effect",
        config.background.effectName
      );
      localStorage.setItem(
        "hydra_background_config",
        config.background.effectConfig ?? "{}"
      );
      window.dispatchEvent(new Event("background_effect_update"));
    }
  } else {
    localStorage.setItem("hydra_background_effect", "none");
    localStorage.setItem("hydra_background_config", "{}");
    window.dispatchEvent(new Event("background_effect_update"));
    if (config.background.mediaUrl) {
      injectBgImage(config.background.mediaUrl);
    } else {
      removeBgMedia();
    }
  }

  inject(buildCSS(config));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearCustomTheme(): void {
  document.getElementById(STYLE_ID)?.remove();
  removeBgMedia();
  localStorage.removeItem(STORAGE_KEY);

  try {
    const raw = localStorage.getItem(ORIGINAL_STATE_KEY);
    let effect = "floatinglines";
    let effectConfig = "{}";
    if (raw) {
      const orig = JSON.parse(raw) as OriginalState;
      effect = orig.effect || "floatinglines";
      effectConfig = orig.effectConfig || "{}";
    }
    localStorage.setItem("hydra_background_effect", effect);
    localStorage.setItem("hydra_background_config", effectConfig);
    window.dispatchEvent(new Event("background_effect_update"));
  } finally {
    localStorage.removeItem(ORIGINAL_STATE_KEY);
  }
}

export function loadActiveCustomTheme(): CustomThemeConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomThemeConfig) : null;
  } catch {
    return null;
  }
}

export function restoreCustomThemeOnBoot(): void {
  const cfg = loadActiveCustomTheme();
  if (cfg) applyCustomTheme(cfg);
}

export interface SavedCustomTheme {
  name: string;
  config: CustomThemeConfig;
  savedAt: number;
}

export function saveCustomTheme(name: string, config: CustomThemeConfig): void {
  // Captura o efeito atual no momento do save para restaurar depois
  const enriched: CustomThemeConfig = {
    ...config,
    background: {
      ...config.background,
      effectName:
        config.background.type === "effect"
          ? (localStorage.getItem("hydra_background_effect") ?? "floatinglines")
          : undefined,
      effectConfig:
        config.background.type === "effect"
          ? (localStorage.getItem("hydra_background_config") ?? "{}")
          : undefined,
    },
  };
  const list = getSavedCustomThemes();
  const updated = [
    { name, config: enriched, savedAt: Date.now() },
    ...list,
  ].slice(0, 20);
  localStorage.setItem(SAVED_KEY, JSON.stringify(updated));
}

export function getSavedCustomThemes(): SavedCustomTheme[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as SavedCustomTheme[]) : [];
  } catch {
    return [];
  }
}

export function deleteSavedCustomTheme(index: number): void {
  const list = getSavedCustomThemes();
  list.splice(index, 1);
  localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}
