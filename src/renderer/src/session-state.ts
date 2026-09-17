import type { UserPreferences } from "@types";
import { levelDBService } from "./services/leveldb.service";
import {
  SESSION_SCOPED_KEY_PREFIXES,
  getSessionScopedKeysToClear,
} from "./session-state-keys";

export {
  SETTINGS_CATEGORY_STORAGE_KEY,
  SETTINGS_EMULATION_VIEW_STORAGE_KEY,
  SETTINGS_EMULATOR_TAB_STORAGE_KEY,
  SETTINGS_RETROARCH_TAB_STORAGE_KEY,
  LIBRARY_PLATFORMS_STORAGE_KEY,
  LIBRARY_INSTALLED_ONLY_STORAGE_KEY,
  SIDEBAR_PLATFORMS_STORAGE_KEY,
  SIDEBAR_PLAYABLE_ONLY_STORAGE_KEY,
} from "./session-state-keys";

const APP_SESSION_ID_KEY = "app-session-id";

const shouldPersistFiltersAndSorting = async () => {
  try {
    const userPreferences = (await levelDBService.get(
      "userPreferences",
      null,
      "json"
    )) as UserPreferences | null;

    return userPreferences?.persistFiltersAndSorting === true;
  } catch (error) {
    console.error("Failed to read the filters persistence preference", error);
    return false;
  }
};

export const clearStateFromPreviousSession = async () => {
  try {
    const sessionId = await globalThis.electron.getAppSessionId();
    if (localStorage.getItem(APP_SESSION_ID_KEY) === sessionId) return;

    const persistFiltersAndSorting = await shouldPersistFiltersAndSorting();

    for (const key of getSessionScopedKeysToClear(persistFiltersAndSorting)) {
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
