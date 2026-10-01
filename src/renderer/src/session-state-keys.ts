export const SETTINGS_CATEGORY_STORAGE_KEY = "settings-category";
export const SETTINGS_EMULATION_VIEW_STORAGE_KEY = "settings-emulation-view";
export const SETTINGS_EMULATOR_TAB_STORAGE_KEY = "settings-emulator-tab";
export const SETTINGS_RETROARCH_TAB_STORAGE_KEY = "settings-retroarch-tab";

export const LIBRARY_PLATFORMS_STORAGE_KEY = "library-platforms";
export const LIBRARY_INSTALLED_ONLY_STORAGE_KEY = "library-installed-only";
export const SIDEBAR_PLATFORMS_STORAGE_KEY = "sidebar-platforms";
export const SIDEBAR_PLAYABLE_ONLY_STORAGE_KEY = "sidebar-playable-only";

export const SESSION_SCOPED_KEY_PREFIXES = [SETTINGS_EMULATOR_TAB_STORAGE_KEY];

const ALWAYS_SESSION_SCOPED_KEYS = [
  SETTINGS_CATEGORY_STORAGE_KEY,
  SETTINGS_EMULATION_VIEW_STORAGE_KEY,
  SETTINGS_RETROARCH_TAB_STORAGE_KEY,
  "library-view-mode",
  "hydra:big-picture:library-view-mode",
];

const FILTER_SESSION_SCOPED_KEYS = [
  "library-sort-by",
  "library-category",
  "library-collection",
  LIBRARY_PLATFORMS_STORAGE_KEY,
  LIBRARY_INSTALLED_ONLY_STORAGE_KEY,
  "sidebar-category",
  "sidebar-sort-by",
  "sidebar-favorites-first",
  SIDEBAR_PLATFORMS_STORAGE_KEY,
  SIDEBAR_PLAYABLE_ONLY_STORAGE_KEY,
  "profile-sort-by",
  "profile-platform",
  "profile-souvenir-sort-by",
  "profile-souvenir-grouping",
  "hydra:big-picture:library-sort-by",
  "hydra:big-picture:library-filter-by",
  "hydra:big-picture:library-tab",
  "hydra:big-picture:sidebar-library-filter",
];

export const getSessionScopedKeysToClear = (
  persistFiltersAndSorting: boolean
): string[] =>
  persistFiltersAndSorting
    ? [...ALWAYS_SESSION_SCOPED_KEYS]
    : [...ALWAYS_SESSION_SCOPED_KEYS, ...FILTER_SESSION_SCOPED_KEYS];
