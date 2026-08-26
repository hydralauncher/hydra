const APP_SESSION_ID_KEY = "app-session-id";

export const SETTINGS_CATEGORY_STORAGE_KEY = "settings-category";
export const SETTINGS_EMULATION_VIEW_STORAGE_KEY = "settings-emulation-view";
export const SETTINGS_EMULATOR_TAB_STORAGE_KEY = "settings-emulator-tab";
export const SETTINGS_RETROARCH_TAB_STORAGE_KEY = "settings-retroarch-tab";

const SESSION_SCOPED_KEY_PREFIXES = [SETTINGS_EMULATOR_TAB_STORAGE_KEY];

const SESSION_SCOPED_KEYS = [
  SETTINGS_CATEGORY_STORAGE_KEY,
  SETTINGS_EMULATION_VIEW_STORAGE_KEY,
  SETTINGS_RETROARCH_TAB_STORAGE_KEY,
  "library-view-mode",
  "library-sort-by",
  "library-category",
  "library-collection",
  "sidebar-category",
  "sidebar-sort-by",
  "sidebar-favorites-first",
  "profile-sort-by",
  "profile-platform",
  "profile-souvenir-sort-by",
  "profile-souvenir-grouping",
  "hydra:big-picture:library-view-mode",
  "hydra:big-picture:library-sort-by",
  "hydra:big-picture:library-filter-by",
];

export const clearStateFromPreviousSession = async () => {
  try {
    const sessionId = await globalThis.electron.getAppSessionId();
    if (localStorage.getItem(APP_SESSION_ID_KEY) === sessionId) return;

    for (const key of SESSION_SCOPED_KEYS) {
      localStorage.removeItem(key);
    }

    for (const key of Object.keys(localStorage)) {
      if (
        SESSION_SCOPED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
      ) {
        localStorage.removeItem(key);
      }
    }

    localStorage.setItem(APP_SESSION_ID_KEY, sessionId);
  } catch (error) {
    console.error("Failed to reset per-session UI state", error);
  }
};
