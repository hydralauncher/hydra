import type { UserPreferences } from "@types";
import { useEffect, useState } from "react";

type ElectronPreferencesBridge = {
  getUserPreferences?: () => Promise<UserPreferences | null>;
  onUserPreferencesUpdated?: (
    cb: (preferences: UserPreferences | null) => void
  ) => () => void;
};

let lastKnownPreferences: UserPreferences | null = null;

export function useUserPreferences() {
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(() => lastKnownPreferences);

  useEffect(() => {
    let isMounted = true;
    const electron = globalThis.window.electron as ElectronPreferencesBridge;

    const apply = (nextPreferences: UserPreferences | null) => {
      lastKnownPreferences = nextPreferences;
      if (isMounted) setUserPreferences(nextPreferences);
    };

    const loadUserPreferences = async () => {
      if (typeof electron.getUserPreferences !== "function") {
        apply(null);
        return;
      }

      try {
        apply(await electron.getUserPreferences());
      } catch {
        apply(null);
      }
    };

    void loadUserPreferences();

    const unsubscribe =
      typeof electron.onUserPreferencesUpdated === "function"
        ? electron.onUserPreferencesUpdated(apply)
        : () => {};

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return userPreferences;
}
