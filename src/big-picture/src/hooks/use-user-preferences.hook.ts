import type { UserPreferences } from "@types";
import { useEffect, useState } from "react";

type ElectronPreferencesBridge = {
  getUserPreferences?: () => Promise<UserPreferences | null>;
  onUserPreferencesUpdated?: (
    cb: (preferences: UserPreferences | null) => void
  ) => () => void;
};

export function useUserPreferences() {
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);

  useEffect(() => {
    let isMounted = true;
    const electron = globalThis.window.electron as ElectronPreferencesBridge;

    const loadUserPreferences = async () => {
      if (typeof electron.getUserPreferences !== "function") {
        if (!isMounted) return;

        setUserPreferences(null);
        return;
      }

      try {
        const nextPreferences = await electron.getUserPreferences();

        if (!isMounted) return;

        setUserPreferences(nextPreferences);
      } catch {
        if (!isMounted) return;

        setUserPreferences(null);
      }
    };

    void loadUserPreferences();

    const unsubscribe =
      typeof electron.onUserPreferencesUpdated === "function"
        ? electron.onUserPreferencesUpdated((nextPreferences) => {
            setUserPreferences(nextPreferences);
          })
        : () => {};

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  return userPreferences;
}
